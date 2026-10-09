import { expireGenerated } from '../files/generated-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { cleanTemp } from '../files/cleanup.mjs';
export async function retention({ db, config, telegram, now = Date.now() }) {
  db.sql.prepare('DELETE FROM messages WHERE receivedAt<?').run(now - 30 * 86400000);
  db.sql.prepare('DELETE FROM agent_messages WHERE date<?').run(now - 7 * 86400000);
  for (const bot of db.sql.prepare('SELECT * FROM bots').all()) {
    const errors = cleanTemp(path.join(config.botsDir, bot.botId), now);
    for (const image of db.sql.prepare('SELECT * FROM generated_images WHERE botId=?').all(bot.botId)) {
      try { if (expireGenerated(config, image.path, now)) { db.sql.prepare('DELETE FROM generated_images WHERE path=?').run(image.path); } }
      catch { errors.push(`Generated image ${image.path}: deletion failed; remove manually on the server`); }
    }
    if (errors.length) { const report = `Ошибка очистки:\n${errors.join('\n')}\nПовторить: /temp cleanup; вручную: /rm путь`; try { await telegram.call(bot.botId, 'sendMessage', { chat_id: bot.ownerId, text: [...report].slice(0, 3900).join('') + ([...report].length > 3900 ? '\n[обрезано]' : '') }); } catch {} }
  }
}
