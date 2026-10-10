import readline from 'node:readline';
import fs from 'node:fs';
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let input;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'config/read' && process.argv[2] === 'blocked-config') fs.writeFileSync(process.argv[3], 'waiting');
  if (m.method === 'initialize') { if (process.argv[2] === 'delayed-init') setTimeout(() => send({ id: m.id, result: {} }), 300); else send({ id: m.id, result: {} }); }
  if (m.method === 'thread/start') { if (process.argv[2] === 'delayed-start') { fs.writeFileSync(process.argv[3], m.params.developerInstructions); setTimeout(() => send({ id:m.id,result:{thread:{id:'thread1'}} }), 200); } else send({ id: m.id, result: { thread: { id: 'thread1' } } }); }
  if (m.method === 'thread/resume') send({ id: m.id, result: { thread: { id: m.params.threadId } } });
  if (m.method === 'turn/start') { input = JSON.parse(m.params.input[0].text); send({ id: m.id, result: { turn: { id: 'turn1' } } }); send({ id: 'tool1', method: 'item/tool/call', params: { threadId: 'thread1', tool: 'send', arguments: { text: input[0].textPlain } } }); }
  if (m.id === 'tool1') {
    if (process.argv[2] === 'background') {
      send({ method: 'item/started', params: { threadId: 'thread1', item: { type: 'subAgentActivity', kind: 'started', agentThreadId: 'child1' } } });
      setTimeout(() => send({ method: 'turn/completed', params: { threadId: 'child1', turn: { id: 'child-turn', status: 'completed' } } }), 100);
    }
    send({ method: 'turn/completed', params: { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } } });
  }
});
