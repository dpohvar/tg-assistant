import readline from 'node:readline';
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'echo') send({ id: m.id, result: m.params });
  if (m.method === 'trigger') { send({ id: m.id, result: {} }); send({ method: 'changed', params: { value: 1 } }); }
  if (m.method === 'permission') { send({ id: m.id, result: {} }); send({ id: 'server-1', method: 'approval', params: {} }); }
  if (m.id === 'server-1' && m.error) send({ method: 'rejected', params: {} });
});
