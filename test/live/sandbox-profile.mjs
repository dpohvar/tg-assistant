import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/storage/database.mjs';
import { CodexAgent } from '../../src/codex/threads.mjs';
const [root, codexHome, codexExecutable] = process.argv.slice(2);
assert(root && codexHome && codexExecutable);
fs.mkdirSync(root, { recursive: true });
const db = openDatabase(path.join(root, 'db.sqlite'));
db.registerBot({ botId: 'sandbox', telegramId: 1, username: 'test', ownerId: 1 });
db.saveChat('sandbox', { id: 1, type: 'private', first_name: 'Test' });
const record = db.ensureAgent('sandbox', 1), scope = { ...record, controllerId: 'live', generation: 1 };
const config = { dataDir: root, botsDir: path.join(root, 'bots'), codexHome, codexExecutable, defaultTimezone: 'UTC' };
const wiki = path.join(config.botsDir, 'sandbox');
const targets = {
  wiki: path.join(wiki, 'canary'),
  ownTemp: path.join(wiki, '.temp', record.agentId, 'canary'),
  otherTemp: path.join(wiki, '.temp', 'another-agent', 'canary'),
  git: path.join(wiki, '.git', 'canary'),
  otherBot: path.join(config.botsDir, 'another-bot', 'canary'),
  controller: path.join(root, 'private', 'canary'),
};
for (const filename of Object.values(targets)) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, 'synthetic-canary'); }
const probe = `import fs from 'node:fs';
const targets=${JSON.stringify(targets)}, results={};
for(const [name,file] of Object.entries(targets)) {
 let read=false,write=false;
 try { read=fs.readFileSync(file,'utf8')==='synthetic-canary'; } catch {}
 try { fs.writeFileSync(file+'.written','test'); write=true; } catch {}
 results[name]={read,write};
}
fs.writeFileSync('sandbox-result.json',JSON.stringify(results));
console.log(JSON.stringify(results));`;
fs.writeFileSync(path.join(wiki, 'sandbox-probe.mjs'), probe);
const agent = new CodexAgent({ db, config }), timeout = setTimeout(() => agent.close(), 120000);
try {
  const result = await agent.run(scope, [{ eventType: 'message', messageId: 1, textPlain: 'Authorized bounded filesystem sandbox test using synthetic canaries only. Execute exactly `node sandbox-probe.mjs` in the current directory with the shell tool. Do not modify the probe. Do not send Telegram messages or spawn agents. Finish after executing it.' }], async () => ({ status: 'ok' }));
  await result.settled;
  const observed = JSON.parse(fs.readFileSync(path.join(wiki, 'sandbox-result.json'), 'utf8'));
  for (const [name, result] of Object.entries(observed)) assert.deepEqual(result, { read: ['wiki', 'ownTemp'].includes(name), write: ['wiki', 'ownTemp'].includes(name) }, name);
  console.log(JSON.stringify({ productionProfile: 'tg-agent', checks: observed }));
} finally { clearTimeout(timeout); await agent.deleteSession(record.agentId, db.agent('sandbox', 1)?.threadId); agent.close(); db.close(); }
