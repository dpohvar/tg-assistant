// One authorized generation and one Telegram upload; no polling or credentials in output.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/storage/database.mjs';
import { CodexAgent } from '../../src/codex/threads.mjs';
import { createController } from '../../src/controller.mjs';
import { createTelegram } from '../../src/telegram/api.mjs';
const [root, codexHome, codexExecutable, tokenFile, recipient, mode] = process.argv.slice(2);
assert(root && codexHome && codexExecutable && tokenFile && /^\d+$/.test(recipient ?? ''));
fs.mkdirSync(root, { recursive: true }); const db = openDatabase(path.join(root, 'db.sqlite'));
const telegram = createTelegram({ getToken: () => fs.readFileSync(tokenFile, 'utf8').trim() });
const me = await telegram.call('image-test', 'getMe');
if (!db.getBot('image-test')) db.registerBot({ botId: 'image-test', telegramId: me.id, username: me.username, ownerId: Number(recipient) });
db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE botId=?').run('image-test');
const config = { dataDir: root, botsDir: path.join(root, 'bots'), codexHome, codexExecutable, defaultTimezone: 'UTC' };
const sent = [], failures = [], wrapped = { getToken: telegram.getToken, async call(botId, method, args, options) { const result = await telegram.call(botId, method, args, options); if (method === 'sendPhoto') sent.push(result.message_id); return result; } };
const agent = new CodexAgent({ db, config }), controller = createController({ db, config, telegram: wrapped, agent, onError: error => failures.push(error.code ?? 'agent_failed') });
const run = agent.run.bind(agent), toolResults = [];
agent.run = (scope, events, invoke) => run(scope, events, async (name, args, threadId) => { try { const result = await invoke(name, args, threadId); toolResults.push({ name, error: result.error, description: result.description }); return result; } catch (error) { toolResults.push({ name, error: error.code ?? 'tool_failed', description: error.message }); throw error; } });
const timeout = setTimeout(() => controller.close(), 300000);
try {
  let text = 'Authorized bounded integration test: generate exactly ONE simple abstract orange-and-blue square image using native image generation. In the SAME JavaScript block extract the saved path from output_hint using / as (.+?) by default\\./ (first capture); discover the normalized save_image name from ALL_TOOLS and call save_image with its default directory. Never print image_url, base64 or the whole generator result. Then send that saved local file using send with photo attach://picture and uploads picture mapped to its saved path; caption: «Генерация → save_image → Telegram: проверка Alpine». Do not regenerate or retry on failure. Do not launch subagents or perform any other actions.';
  if (mode === 'retry-send') {
    const a = db.agent('image-test', Number(recipient)), dir = `.temp/${a.agentId}/upload`, file = fs.readdirSync(path.join(config.botsDir, 'image-test', dir)).find(name => name.endsWith('.png'));
    assert(file);
    text = `Authorized bounded test correction: do NOT generate another image. Send the existing local file ${dir}/${file} using send, photo attach://picture, uploads picture set to that literal path. Caption: «Генерация → save_image → Telegram: проверка Alpine». Print the short send tool result so errors are visible. If a controller tool returns a JSON string, parse it before reading fields. Do not do any other actions.`;
  }
  if (mode === 'normalize-save-send') {
    const source = db.sql.prepare('SELECT path FROM generated_images ORDER BY path LIMIT 1').get().path;
    text = `Authorized bounded test: do NOT generate an image. In one JavaScript block, call save_image for savedPath ${JSON.stringify(source)} with its default directory, print ONLY its returned JavaScript type, normalize the result with typeof r === 'string' ? JSON.parse(r) : r, then send the saved file using photo attach://picture and uploads picture set to parsed.path. Caption: «Сохранение и загрузка без повторной генерации». Print the short send result. Do not do other actions.`;
  }
  await controller.receive('image-test', { message: { message_id: mode === 'retry-send' ? 90000003 : 90000002, date: Math.floor(Date.now() / 1000), chat: { id: Number(recipient), type: 'private' }, from: { id: Number(recipient), first_name: 'Owner' }, text } });
  await controller.idle();
  console.log(JSON.stringify({ toolResults })); assert.deepEqual(failures, []); assert.equal(sent.length, 1);
  const registered = db.sql.prepare('SELECT count(*) AS count FROM generated_images').get().count;
  assert.equal(registered, 1);
  console.log(JSON.stringify({ passed: true, messageIds: sent, registeredImages: registered }));
} finally { clearTimeout(timeout); const record = db.agent('image-test', Number(recipient)); try { if (record) await agent.deleteSession(record.agentId, record.threadId); } finally { controller.close(); db.close(); } }
