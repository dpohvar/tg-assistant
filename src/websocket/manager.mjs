import path from 'node:path';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {BotFiles} from '../files/paths.mjs';
import {websocketFiles} from './files.mjs';
const MiB=1024*1024;
const error=(code,description)=>Object.assign(new Error(description),{code});
export class WebSocketManager {
 records=new Map(); stopped=false;
 constructor({botsDir,clock=Date.now,onEvent=()=>{},onError=()=>{}}){Object.assign(this,{botsDir,clock,onEvent,onError});this.timer=setInterval(()=>this.sweep(),1000);this.timer.unref();}
 owned(s,id){const r=this.records.get(id);if(!r||r.scope.botId!==s.botId||r.scope.agentId!==s.agentId)throw error('websocket_not_found','WebSocket is not available to this agent.');return r;}
 notify(r,event){try{this.onEvent(r.scope,{connectionId:r.connectionId,...event});}catch(e){this.onError(e);}}
 async open(scope,{url,description,headers={}}){
  if(this.stopped)throw error('websocket_closed','WebSocket service is stopped.');
  let target;try{target=new URL(url);}catch{throw error('invalid_argument','Invalid WebSocket URL.');}
  if(!['ws:','wss:'].includes(target.protocol)||typeof description!=='string'||![...description].length||[...description].length>100||!headers||typeof headers!=='object'||Array.isArray(headers)||Object.entries(headers).some(([k,v])=>!k||typeof v!=='string'||/[\r\n]/.test(k+v)))throw error('invalid_argument','Use ws/wss URL, a description of 1–100 characters and string headers without newlines.');
  if([...this.records.values()].filter(r=>r.scope.botId===scope.botId&&r.scope.agentId===scope.agentId).length>=10)throw error('websocket_limit','Delete a WebSocket record before opening more than 10 connections.');
  const id='w'+randomUUID().replaceAll('-',''),r={connectionId:id,scope:{...scope},description,origin:target.origin,status:'opening',openedAt:this.clock(),receivedBytes:0,sentBytes:0,buffer:[],queuedBytes:0,serial:0};
  r.files=websocketFiles(this.botsDir,scope,id);this.records.set(id,r);
  try{await new Promise((resolve,reject)=>{
   const ws=new WebSocket(url,{headers,maxPayload:10*MiB,perMessageDeflate:false,handshakeTimeout:15000});r.socket=ws;
   ws.on('open',()=>{if(this.records.get(id)!==r||r.status!=='opening'){ws.terminate();reject(error('websocket_closed','Connection was closed while opening.'));return;}r.status='open';resolve();});
   ws.on('message',(bytes,binary)=>{if(this.records.get(id)!==r||r.status!=='open')return;try{this.receive(r,bytes,binary);}catch{this.close(scope,id,{reason:'storage_error',notify:true});}});
   ws.on('error',()=>{if(r.status==='opening')reject(error('websocket_connect_failed','WebSocket connection could not be opened. Check URL, credentials and server availability.'));else if(this.records.get(id)===r&&r.status==='open')this.close(scope,id,{reason:'transport_error',notify:true});});
   ws.on('close',code=>{if(r.status==='opening')reject(error('websocket_connect_failed','WebSocket closed before opening.'));else if(this.records.get(id)===r&&r.status==='open')this.markClosed(r,'server',true,{code});});
  });return {connectionId:id};}catch(e){if(r.status==='opening'){this.records.delete(id);r.socket?.terminate();}throw e?.code?.startsWith('websocket_')?e:error('websocket_connect_failed','WebSocket connection could not be opened.');}
 }
 receive(r,bytes,binary){
  const data=Buffer.from(bytes);r.receivedBytes+=data.length;let message;
  if(binary){message={type:'binary',bytes:data.length};if(r.files.size()>10*MiB)Object.assign(message,{skipped:true,reason:'binary_storage_full'});else Object.assign(message,{path:`${r.files.dir}/packet-${r.serial+1}.bin`});}
  else message={type:'text',data:data.toString('utf8')};
  const cost=Buffer.byteLength(JSON.stringify(message));
  if(r.queuedBytes+cost>MiB){this.close(r.scope,r.connectionId,{reason:'buffer_overflow',notify:true,details:{droppedMessages:1}});return;}
  if(message.path)r.files.write(`packet-${r.serial+1}.bin`,data);r.serial++;
  const empty=!r.buffer.length;r.buffer.push(message);r.queuedBytes+=cost;
  if(empty)this.notify(r,{eventType:'websocket_ready'});
 }
 list(scope){return {connections:[...this.records.values()].filter(r=>r.scope.botId===scope.botId&&r.scope.agentId===scope.agentId).map(r=>({connectionId:r.connectionId,description:r.description,origin:r.origin,status:r.status,openedAt:new Date(r.openedAt).toISOString(),...(r.closedAt!==undefined?{closedAt:new Date(r.closedAt).toISOString()}:{}),receivedBytes:r.receivedBytes,sentBytes:r.sentBytes,queued:r.buffer.length,queuedBytes:r.queuedBytes,binaryBytes:r.files.size()}))};}
 pull(scope,{connectionId,count}){
  const r=this.owned(scope,connectionId);if(!Number.isSafeInteger(count)||count<1)throw error('invalid_argument','count must be a positive integer.');
  const messages=r.buffer.slice(0,count).map(m=>m.path&&!r.files.exists(m.path)?{type:'binary',bytes:m.bytes,skipped:true,reason:'file_expired'}:m);
  const taken=r.buffer.splice(0,count);r.queuedBytes-=taken.reduce((n,m)=>n+Buffer.byteLength(JSON.stringify(m)),0);return {messages,remaining:r.buffer.length};
 }
 async send(scope,args){
  const r=this.owned(scope,args.connectionId);if(r.status!=='open')throw error('websocket_closed','WebSocket is closed.');
  const text=typeof args.text==='string',file=typeof args.path==='string';if(text===file)throw error('invalid_argument','Provide exactly one text or path.');
  let bytes;try{bytes=text?args.text:new BotFiles(path.join(this.botsDir,scope.botId),scope.agentId).read(args.path);}catch{throw error('invalid_argument','The file is unavailable in this agent filesystem.');}
  await new Promise((resolve,reject)=>r.socket.send(bytes,{binary:file},e=>e?reject(error('websocket_send_failed','WebSocket message could not be sent.')):resolve()));r.sentBytes+=text?Buffer.byteLength(bytes):bytes.length;return {status:'sent'};
 }
 markClosed(r,reason,notify,details={}){if(r.status==='closed')return;r.status='closed';r.closedAt=this.clock();if(notify)this.notify(r,{eventType:'websocket_closed',reason,...details});}
 close(scope,id,{reason='agent',notify=reason!=='agent',details={}}={}){const r=this.owned(scope,id);if(r.status!=='closed'){this.markClosed(r,reason,notify,details);r.socket?.terminate();}return {status:'closed'};}
 delete(scope,id,{reason='agent',notify=reason!=='agent'}={}){const r=this.owned(scope,id);r.files.remove();this.records.delete(id);r.socket?.terminate();r.buffer=[];r.queuedBytes=0;if(notify)this.notify(r,{eventType:'websocket_deleted',reason});return {status:'deleted'};}
 closeAgent(agentId,reason='agent_stopped'){for(const r of [...this.records.values()])if(r.scope.agentId===agentId)this.close(r.scope,r.connectionId,{reason,notify:false});}
 deleteAgent(agentId){for(const r of [...this.records.values()])if(r.scope.agentId===agentId)this.delete(r.scope,r.connectionId,{notify:false});}
 deleteBot(botId){for(const r of [...this.records.values()])if(r.scope.botId===botId)this.delete(r.scope,r.connectionId,{notify:false});}
 sweep(now=this.clock()){for(const r of [...this.records.values()])if(r.status==='closed'&&now-r.closedAt>=3600000)try{this.delete(r.scope,r.connectionId,{reason:'expired'});}catch(e){this.onError(e);}}
 shutdown(){this.stopped=true;clearInterval(this.timer);for(const r of this.records.values())r.socket?.terminate();this.records.clear();}
}
