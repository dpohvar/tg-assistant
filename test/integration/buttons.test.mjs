import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createController } from '../../src/controller.mjs';

test('full queue rejects a grouped click without consuming the choice; accepted choice is one-shot', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-buttons-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 });
  const chat = { id: 1, type: 'private' }, batches = [], acknowledgements = []; let finish;
  const stored = { message_id: 100, date: 1000, chat, text: 'Choose', reply_markup: { inline_keyboard: [[{ text: '⬜️ A', callback_data: '[g]a' }, { text: '⬜️ B', callback_data: '[g]b' }]] } };
  const c = createController({ db, telegram: { call: async (_bot, method, args) => {
    if (method === 'answerCallbackQuery') { acknowledgements.push(args); return true; }
    if (method === 'editMessageReplyMarkup') return { ...stored, reply_markup: args.reply_markup };
    return true;
  } }, agent: { run: async (_scope, events) => { batches.push(events); if (batches.length === 1) await new Promise(resolve => { finish = resolve; }); } } });
  t.after(() => { c.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const message = n => ({ message: { message_id: n, date: 1000, chat, from: { id: 1 }, text: 'work' } });
  await c.receive('b', message(1)); await new Promise(resolve => setImmediate(resolve));
  for (let n = 2; n <= 11; n++) await c.receive('b', message(n));
  db.saveMessage('b', stored);
  const click = id => c.receive('b', { callback_query: { id, from: { id: 1, first_name: 'Owner' }, message: stored, data: '[g]a' } });
  await click('full'); assert.match(acknowledgements.at(-1).text, /занят/);
  assert.equal(db.sql.prepare('SELECT 1 FROM button_state WHERE botId=?').get('b'), undefined);
  const a = db.agent('b', 1); c.queue.clear(a.agentId);
  await click('accepted'); await click('duplicate');
  assert.equal(c.queue.pending(a.agentId), 1);
  assert.match(acknowledgements.at(-1).text, /Кнопка недоступна|Выбор уже сделан/);
  assert.equal(db.getMessage('b', 1, 100).reply_markup.inline_keyboard[0][0].text, '✅ A');
  finish(); await c.idle(); assert.equal(batches[1][0].eventType, 'button');
});
