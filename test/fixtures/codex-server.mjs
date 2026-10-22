import readline from 'node:readline';
import fs from 'node:fs';
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let input;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  // Native App Server rejects mixing canonical and legacy dynamic tool envelopes.
  if (['thread/start','thread/resume'].includes(m.method)) {
    const formats = new Set((m.params.dynamicTools ?? []).map(t => t.type === undefined ? 'legacy' : 'canonical'));
    if (formats.size > 1) { send({id:m.id,error:{code:-32600,message:'Invalid request: dynamic tools must use either canonical or legacy format consistently'}}); return; }
  }
  if (m.method === 'config/read' && process.argv[2] === 'blocked-config') fs.writeFileSync(process.argv[3], 'waiting');
  if (m.method === 'initialize') { if (process.argv[2] === 'delayed-init') setTimeout(() => send({ id: m.id, result: {} }), 300); else send({ id: m.id, result: {} }); }
  if (m.method === 'thread/start') { if (process.argv[2] === 'delayed-start') { fs.writeFileSync(process.argv[3]+'.tmp', m.params.developerInstructions); fs.renameSync(process.argv[3]+'.tmp',process.argv[3]); setTimeout(() => send({ id:m.id,result:{thread:{id:'thread1'}} }), 200); } else send({ id: m.id, result: { thread: { id: 'thread1' } } }); }
  if (m.method === 'thread/resume') send({ id: m.id, result: { thread: { id: m.params.threadId } } });
  if (m.method === 'turn/start') { input = JSON.parse(m.params.input[0].text); send({ id: m.id, result: { turn: { id: 'turn1' } } }); send({method:'turn/started',params:{threadId:'thread1',turn:{id:'turn1'}}});send({ id: 'tool1', method: 'item/tool/call', params: { threadId: 'thread1',turnId:'turn1', tool: 'send', arguments: { text: input.find(e=>e.textPlain!==undefined)?.textPlain } } }); }
  if (m.id === 'tool1') {
    if (process.argv[2] === 'turn-failure') { send({method:'turn/completed',params:{threadId:'thread1',turn:{id:'turn1',status:'failed',error:{message:'PRIVATE_PROMPT cannot be sent',additionalDetails:'PRIVATE_DETAIL',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:401}}}}}}); return; }
    if (process.argv[2] === 'tool-error') fs.writeFileSync(process.argv[3], JSON.stringify(m.result));
    if (['background','background-failure'].includes(process.argv[2])) {
      send({ method: 'item/started', params: { threadId: 'thread1', item: { type: 'subAgentActivity', kind: 'started', agentThreadId: 'child1' } } });
      setTimeout(() => send({ method: 'turn/completed', params: { threadId: 'child1', turn: { id: 'child-turn', status: process.argv[2]==='background'?'completed':'failed', ...(process.argv[2]==='background-failure'?{error:{message:'PRIVATE_CHILD_DATA',codexErrorInfo:'badRequest'}}:{}) } } }), 100);
    }
    send({ method: 'turn/completed', params: { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } } });
  }
});
