import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createController } from '../../src/controller.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-controller-'));
  const db = openDatabase(path.join(root, 'test.sqlite'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b1', telegramId: 42, username: 'test_bot', ownerId: 123 });
  const inputs = [], calls = [];
  const telegram = { async call(botId, method, args) { calls.push({ botId, method, args }); return { message_id: 9, chat: { id: args.chat_id, type: 'private' }, date: 1791383000, text: args.text }; } };
  const agent = { async run(scope, events, tools) { inputs.push(events); await tools('send', { text: 'Ответ' }); } };
  const controller = createController({ db, telegram, agent });
  return { root, db, inputs, calls, controller };
}
const message = (id = 1, chatId = 123) => ({ message_id: id, date: 1791383000, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Андрей' }, text: 'Привет' });

test('authorized DM is stored, delivered as JSON events and answered', async t => {
  const f = fixture(t);
  await f.controller.receive('b1', { update_id: 1, message: message() });
  await f.controller.idle();
  assert.deepEqual(f.inputs, [[{ eventType: 'message', messageId: 1, date: new Date(1791383000000).toISOString(), from: { userId: 123, name: 'Андрей' }, textPlain: 'Привет' }]]);
  assert.equal(f.calls[0].method, 'sendMessage');
  assert.equal(f.calls[0].args.chat_id, 123);
  assert.equal(f.db.getMessage('b1', 123, 1).text, 'Привет');
});
test('unauthorized DM including start is ignored without persistence or inference', async t => {
  const f = fixture(t);
  await f.controller.receive('b1', { update_id: 1, message: { ...message(1, 456), text: '/start' } });
  await f.controller.idle();
  assert.equal(f.inputs.length, 0);
  assert.equal(f.db.getMessage('b1', 456, 1), null);
});
test('message IDs are scoped by bot and chat; edit preserves first receipt', t => {
  const f = fixture(t);
  f.db.saveMessage('b1', message(), 100);
  f.db.saveMessage('b1', message(1, 456), 200);
  f.db.saveMessage('b1', { ...message(), text: 'edited', edit_date: 1791383010 }, 300);
  assert.equal(f.db.messageRecord('b1', 123, 1).receivedAt, 100);
  assert.equal(f.db.getMessage('b1', 456, 1).text, 'Привет');
});
test('SQLite persists and rolls back a failed transaction', t => {
  const f = fixture(t);
  assert.throws(() => f.db.transaction(() => { f.db.saveMessage('b1', message()); throw new Error('stop'); }));
  assert.equal(f.db.getMessage('b1', 123, 1), null);
  f.db.saveMessage('b1', message());
  const second = openDatabase(path.join(f.root, 'test.sqlite'));
  assert.equal(second.getMessage('b1', 123, 1).text, 'Привет');
  second.close();
});
