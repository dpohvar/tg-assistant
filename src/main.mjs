import { ignoreHangup } from './service/signals.mjs';
import { verifyCodexVersion } from './codex/version.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { openDatabase } from './storage/database.mjs';
import { createTelegram } from './telegram/api.mjs';
import { poll } from './telegram/polling.mjs';
import { CodexAgent } from './codex/threads.mjs';
import { createController } from './controller.mjs';
import { retention } from './storage/retention.mjs';
import { acquireLock } from './service/lock.mjs';
import { Pollers } from './service/pollers.mjs';
ignoreHangup();
const config = loadConfig(process.argv[2] ?? 'config.json');
await verifyCodexVersion(config.codexExecutable);
fs.mkdirSync(config.dataDir, { recursive: true }); const releaseLock = acquireLock(path.join(config.dataDir, 'controller.lock'));
const readyPath = path.join(config.dataDir, 'controller.ready');
const readyIdentity = fs.readFileSync(path.join(config.dataDir, 'controller.lock'), 'utf8');
fs.rmSync(readyPath, { force: true });
const db = openDatabase(path.join(config.dataDir, 'controller.sqlite'));
const tokens = new Map((config.initialBots ?? []).map(bot => [bot.botId, bot.tokenFile]));
const telegram = createTelegram({ getToken: botId => { const file = botId === 'master' ? config.masterTokenFile : tokens.get(botId) ?? db.getBot(botId)?.secretRef; return file ? fs.readFileSync(file, 'utf8').trim() : null; } });
config.masterTelegramId = (await telegram.call('master', 'getMe')).id;
for (const bot of config.initialBots ?? []) {
  const me = await telegram.call(bot.botId, 'getMe');
  if (me.id === config.masterTelegramId) throw new Error('Cannot register the master bot as a child.');
  if (!db.getBot(bot.botId)) db.registerBot({ botId: bot.botId, telegramId: me.id, username: me.username, ownerId: bot.ownerId ?? config.serviceOwnerId, defaultModel: config.defaultModel });
  db.sql.prepare('UPDATE bots SET secretRef=? WHERE botId=?').run(bot.tokenFile, bot.botId);
}
const agent = new CodexAgent({ db, config });
const keyPath = path.join(config.dataDir, 'secrets', 'cursor-key'); fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
const controller = createController({ db, telegram, agent, config, cursorKey: fs.readFileSync(keyPath), onError: () => console.error('agent_failed') });
const stop = new AbortController();
let cleanupJob;
const cleanupTimer = setInterval(() => { if (!cleanupJob) cleanupJob = retention({ db, config, telegram }).catch(() => console.error('cleanup_failed')).finally(() => { cleanupJob = null; }); }, 86400000);
controller.scheduler.recover();
const pollers = new Pollers((botId, signal) => poll({ botId, telegram, signal, getOffset: () => botId === 'master' ? Number(db.sql.prepare("SELECT value FROM controller_state WHERE key='master_offset'").get()?.value ?? 0) : db.getOffset(botId), setOffset: n => { if (botId === 'master') db.sql.prepare("INSERT INTO controller_state VALUES('master_offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(n)); else if (db.getBot(botId)) db.setOffset(botId, n); }, receive: controller.receive, onError: code => console.error(code) }), () => console.error('poll_failed'));
const startBot = botId => pollers.start(botId);
config.onBotAdded = botId => startBot(botId);
config.onBotRemoved = botId => pollers.remove(botId);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop.abort(); controller.close(); void pollers.close(); });
try {
  startBot('master'); for (const { botId } of db.sql.prepare('SELECT botId FROM bots').all()) startBot(botId); fs.writeFileSync(readyPath, readyIdentity, { mode: 0o600 }); await pollers.wait();
} finally { fs.rmSync(readyPath, { force: true }); clearInterval(cleanupTimer); controller.close(); await pollers.close(); await controller.idle(); await cleanupJob; db.close(); releaseLock(); }
