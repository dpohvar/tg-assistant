import {parseTarget} from './contract.mjs';import {syntaxError} from './arguments.mjs';
export async function handleWebSocketCommand({botId,message,parts,manager,target,send}){
 const action=parts[0]??'list';
 if(action==='list'){
  const {a}=target(parseTarget(parts.slice(1)));if(!a){await send('No connections');return;}
  const rows=manager.list({botId,agentId:a.agentId}).connections;
  const text=rows.map(r=>`${r.connectionId} — ${r.description}\n${r.origin} · ${r.status}\nOpened: ${r.openedAt}\nReceived: ${r.receivedBytes} B · sent: ${r.sentBytes} B\nQueue: ${r.queued} messages · ${r.queuedBytes} B\nBinary files: ${r.binaryBytes} B`).join('\n\n');await send({text:text||'No connections',entities:[]});return;
 }
 if(['close','delete'].includes(action)&&parts.length===2){const r=manager.records.get(parts[1]);if(!r||r.scope.botId!==botId)throw syntaxError('WebSocket not found.');manager[action](r.scope,r.connectionId,{reason:'admin'});await send(action==='close'?'Connection closed':'Connection deleted');return;}
 throw syntaxError('Invalid WebSocket arguments.');
}
