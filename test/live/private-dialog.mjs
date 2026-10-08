// Bounded live controller check. No polling or background service is left running.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/storage/database.mjs';
import { CodexAgent } from '../../src/codex/threads.mjs';
import { createController } from '../../src/controller.mjs';
import { createTelegram } from '../../src/telegram/api.mjs';
const [root, home, executable, tokenFile, ownerArg] = process.argv.slice(2);
const ownerId = Number(ownerArg);
assert(root && home && executable && tokenFile && Number.isSafeInteger(ownerId));
const db = openDatabase(path.join(root, 'controller.sqlite'));
if (!db.getBot('live')) db.registerBot({ botId: 'live', telegramId: 8322579566, username: 'dpohvar_ai_assistant_bot', ownerId });
const config = { dataDir: root, botsDir: path.join(root, 'bots'), codexHome: home, codexExecutable: executable, defaultTimezone: 'Asia/Nicosia' };
const telegram = createTelegram({ getToken: () => fs.readFileSync(tokenFile, 'utf8').trim() });
const sent = [], failures = [];
const wrapped = { async call(botId, method, args, options) { const result = await telegram.call(botId, method, args, options); if (method === 'sendMessage') sent.push(result.message_id); return result; } };
const agent = new CodexAgent({ db, config });
const controller = createController({ db, telegram: wrapped, agent, onError: e => failures.push(e.message) });
const timeout = setTimeout(() => controller.close(), 120000);
try {
  await controller.receive('live', { update_id: 1, message: { message_id: 90000001, date: Math.floor(Date.now() / 1000), chat: { id: ownerId, type: 'private', first_name: 'Owner' }, from: { id: ownerId, first_name: 'Owner' }, text: 'This is an authorized bounded integration test. Use send exactly once to publish this Russian text: «Проверка контроллера в Alpine: ЛС → Codex → Telegram работает.» Do not do other actions.' } });
  await controller.idle();
  assert.deepEqual(failures, []); assert.equal(sent.length, 1);
  console.log(JSON.stringify({ passed: true, messageIds: sent }));
} finally { clearTimeout(timeout); controller.close(); db.close(); }
