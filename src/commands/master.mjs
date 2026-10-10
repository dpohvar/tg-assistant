import { expireGenerated } from '../files/generated-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createTelegram } from '../telegram/api.mjs';
export function createMaster({ db, config, onBotAdded = () => {}, onBotRemoved = async () => {}, probeToken = token => createTelegram({ getToken: () => token }).call('registration', 'getMe') }) {
  return async (name, args, message, reply) => {
    const respond = text => reply('master', message, text);
    if (name === 'newbot') {
      if (args.length < 1 || args.length > 2 || !/^\d+:[\w-]+$/.test(args[0])) throw new Error('Invalid token syntax');
      const ownerId = args[1] ? Number(args[1]) : message.from.id;
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('Invalid owner ID');
      const me = await probeToken(args[0]);
      if (me.id === config.masterTelegramId) throw new Error('Cannot register the master bot as a child.');
      const botId = 'b' + me.id;
      if (db.getBot(botId)) throw new Error('Already registered');
      const secrets = path.join(config.dataDir, 'secrets'); fs.mkdirSync(secrets, { recursive: true, mode: 0o700 });
      const secretRef = path.join(secrets, botId + '.token'); fs.writeFileSync(secretRef, args[0], { mode: 0o600, flag: 'wx' });
      try { fs.mkdirSync(path.join(config.botsDir, botId), { recursive: true }); db.transaction(() => { db.registerBot({ botId, telegramId: me.id, username: me.username, ownerId, defaultModel: config.defaultModel }); db.sql.prepare('UPDATE bots SET secretRef=? WHERE botId=?').run(secretRef, botId); }); } catch (error) { fs.rmSync(secretRef, { force: true }); throw error; }
      onBotAdded(botId); await respond(`Registered @${me.username}, BOT_ID ${me.id}, owner ${ownerId}`); return;
    }
    if (name === 'bots') { if (args.length) throw new Error('No arguments expected'); const bots = db.sql.prepare('SELECT * FROM bots ORDER BY telegramId').all(); await respond(bots.map(b => `@${b.username} ${b.telegramId} owner ${b.ownerId}`).join('\n') || 'No records'); return; }
    const bot = db.sql.prepare('SELECT * FROM bots WHERE lower(username)=lower(?)').get((args[0] ?? '').replace(/^@/, ''));
    if (!bot) throw new Error('Unknown bot');
    if (name === 'set_owner') { const userId = Number(args[1]); if (args.length !== 2 || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid owner ID'); if(userId!==bot.ownerId) db.transaction(()=>{db.setRole(bot.botId,bot.ownerId,'admin');db.sql.prepare('UPDATE bots SET ownerId=? WHERE botId=?').run(userId,bot.botId);}); await respond('Owner changed'); return; }
    if (name === 'delete_bot') {
      if (args.length === 1) { await respond(`@${bot.username} ${bot.telegramId}, owner ${bot.ownerId}\n/delete_bot @${bot.username} ${bot.telegramId}\n/delete_bot @${bot.username} ${bot.telegramId} all`); return; }
      if (Number(args[1]) !== bot.telegramId || args.length > 3 || args[2] && args[2] !== 'all') throw new Error('Invalid deletion arguments');
      await onBotRemoved(bot.botId);
      const gitSecret = db.sql.prepare('SELECT secretRef FROM git_settings WHERE botId=?').get(bot.botId)?.secretRef;
      for (const image of db.sql.prepare('SELECT * FROM generated_images WHERE botId=?').all(bot.botId)) { expireGenerated(config, image.path, Date.now(), true); db.sql.prepare('DELETE FROM generated_images WHERE path=?').run(image.path); }
      db.sql.prepare('DELETE FROM bots WHERE botId=?').run(bot.botId);
      db.sql.prepare('DELETE FROM controller_state WHERE key=?').run('wiki_updated:' + bot.botId);
      if (gitSecret) fs.rmSync(gitSecret, { force: true });
      if (bot.secretRef) fs.rmSync(bot.secretRef, { force: true });
      fs.rmSync(path.join(config.dataDir, 'rules', bot.botId), { recursive: true, force: true });
      if (args[2] === 'all') fs.rmSync(path.join(config.botsDir, bot.botId), { recursive: true, force: true });
      else fs.rmSync(path.join(config.botsDir, bot.botId, '.temp'), { recursive: true, force: true });
      await respond('Bot deleted' + (args[2] === 'all' ? ', files deleted' : ', wiki retained')); return;
    }
    throw new Error('Unknown master command');
  };
}
