import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/storage/database.mjs';
import { CodexAgent } from '../../src/codex/threads.mjs';
const [root, codexHome, codexExecutable] = process.argv.slice(2);
assert(root && codexHome && codexExecutable);
fs.mkdirSync(root, { recursive: true });
const db = openDatabase(path.join(root, 'db.sqlite'));
if (!db.getBot('background')) db.registerBot({ botId: 'background', telegramId: 1, username: 'test', ownerId: 1 });
db.saveChat('background', { id: 1, type: 'private', first_name: 'Test' });
db.sql.prepare('UPDATE agents SET threadId=NULL WHERE botId=?').run('background');
const record = db.ensureAgent('background', 1), scope = { ...record, controllerId: 'live', generation: 1 };
const config = { dataDir: root, botsDir: path.join(root, 'bots'), codexHome, codexExecutable, defaultTimezone: 'UTC' };
const observations = [], started = Date.now(), agent = new CodexAgent({ db, config });
const timeout = setTimeout(() => agent.close(), 120000);
try {
  const s = await agent.session(scope, async () => ({ status: 'ok' }));
  s.rpc.on('notification', message => {
    const p = message.params;
    if (['turn/completed', 'thread/status/changed', 'error', 'item/started', 'item/completed'].includes(message.method)) observations.push({ ms: Date.now() - started, method: message.method, thread: p.threadId === s.threadId ? 'root' : 'child', kind: p.item?.kind, itemType: p.item?.type, status: p.turn?.status ?? p.status?.type, exitCode: p.item?.exitCode });
  });
  const result = await agent.run(scope, [{ eventType: 'message', messageId: 1, textPlain: 'Authorized bounded runtime test. Spawn one native subagent. Ask it to run a shell command which sleeps 8 seconds and then writes child-complete.txt in the current wiki directory. The root must finish immediately after spawning without waiting for the child, so we can check background execution. Do not send Telegram messages or create other agents.' }], async () => ({ status: 'ok' }));
  const returnedAt = Date.now() - started;
  await result.settled;
  const settledAt = Date.now() - started;
  console.log(JSON.stringify({ returnedAt, settledAt, markerPresent: ['child-complete.txt', 'wiki/child-complete.txt'].some(name => fs.existsSync(path.join(config.botsDir, 'background', name))), observations }));
} finally { clearTimeout(timeout); await agent.deleteSession(record.agentId, db.agent('background', 1)?.threadId); agent.close(); db.close(); }
