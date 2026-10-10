import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {WebSocketServer} from 'ws';
import {WebSocketManager} from '../../src/websocket/manager.mjs';
const pause=()=>new Promise(r=>setTimeout(r,25));
test('real WS FIFO, binary, counters, ownership, close and delete',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-'));const server=new WebSocketServer({port:0});await new Promise(r=>server.once('listening',r));
 t.after(()=>{for(const c of server.clients)c.terminate();server.close();fs.rmSync(root,{recursive:true,force:true});});
 let peer;server.on('connection',c=>{peer=c;c.on('message',(b,binary)=>c.send(b,{binary}));});const events=[];
 const m=new WebSocketManager({botsDir:root,onEvent:(s,e)=>events.push(e)});t.after(()=>m.shutdown());const s={botId:'b',agentId:'a'};
 const {connectionId}=await m.open(s,{url:`ws://127.0.0.1:${server.address().port}/secret?token=private`,description:'echo'});
 await m.send(s,{connectionId,text:'hello'});await pause();peer.send(Buffer.from([1,2,3]));await pause();
 assert.equal(events.filter(e=>e.eventType==='websocket_ready').length,1);assert.ok(!JSON.stringify(m.list(s)).includes('private'));
 assert.throws(()=>m.pull({...s,agentId:'other'},{connectionId,count:1}),/not available/);
 const first=m.pull(s,{connectionId,count:1});assert.equal(first.messages[0].data,'hello');assert.equal(first.remaining,1);
 const second=m.pull(s,{connectionId,count:1});assert.deepEqual(fs.readFileSync(path.join(root,'b',second.messages[0].path)),Buffer.from([1,2,3]));
 await m.send(s,{connectionId,path:second.messages[0].path});await pause();assert.equal(m.list(s).connections[0].receivedBytes,11);
 m.close(s,connectionId);await pause();assert.equal(m.list(s).connections[0].status,'closed');assert.equal(m.pull(s,{connectionId,count:10}).messages.length,1);
 m.delete(s,connectionId);assert.equal(m.list(s).connections.length,0);
});
test('limits include closed records and TTL does not extend',async t=>{
 let now=0;const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-limits-'));const server=new WebSocketServer({port:0});await new Promise(r=>server.once('listening',r));t.after(()=>{server.close();fs.rmSync(root,{recursive:true,force:true});});
 const ev=[],m=new WebSocketManager({botsDir:root,clock:()=>now,onEvent:(s,e)=>ev.push(e)});t.after(()=>m.shutdown());const s={botId:'b',agentId:'a'},url=`ws://127.0.0.1:${server.address().port}`;
 for(let i=0;i<10;i++){const {connectionId}=await m.open(s,{url,description:'test'});m.close(s,connectionId);}await assert.rejects(m.open(s,{url,description:'11'}),{code:'websocket_limit'});
 now=3599999;m.close(s,m.list(s).connections[0].connectionId);m.sweep();assert.equal(m.list(s).connections.length,10);now=3600000;m.sweep();assert.equal(m.list(s).connections.length,0);assert.equal(ev.filter(x=>x.reason==='expired').length,10);
});
test('buffer overflow closes, binary quota skips, expiration and stale callback',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-quota-'));const server=new WebSocketServer({port:0});await new Promise(r=>server.once('listening',r));t.after(()=>{for(const c of server.clients)c.terminate();server.close();fs.rmSync(root,{recursive:true,force:true});});let peer;server.on('connection',c=>peer=c);
 const events=[],m=new WebSocketManager({botsDir:root,onEvent:(s,e)=>events.push(e)});t.after(()=>m.shutdown());const s={botId:'b',agentId:'a'},url=`ws://127.0.0.1:${server.address().port}`,id=(await m.open(s,{url,description:'quota'})).connectionId;
 peer.send(Buffer.alloc(10*1024*1024));await new Promise(r=>setTimeout(r,100));peer.send(Buffer.alloc(1));await pause();peer.send(Buffer.alloc(1));await pause();
 const out=m.pull(s,{connectionId:id,count:3});assert.equal(out.messages[2].reason,'binary_storage_full');fs.unlinkSync(path.join(root,'b',out.messages[0].path));peer.send(Buffer.alloc(1));await pause();const pending=m.list(s).connections[0];assert.equal(pending.queued,1);
 const f=m.records.get(id).buffer[0].path;fs.unlinkSync(path.join(root,'b',f));assert.equal(m.pull(s,{connectionId:id,count:1}).messages[0].reason,'file_expired');
 peer.send('x'.repeat(1024*1024));await pause();assert.equal(m.list(s).connections[0].status,'closed');assert.ok(events.some(e=>e.reason==='buffer_overflow'));
 m.delete(s,id);assert.equal(m.list(s).connections.length,0);
});
