import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase } from '../../src/storage/database.mjs';
import { createAccess } from '../../src/access/scope.mjs';
import { createHistory } from '../../src/agents/history.mjs';
test('discussion traversal includes nested replies before applying text filters', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-discussion-')); const db = openDatabase(path.join(root, 'db.sqlite')); t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b', telegramId: 42, username: 'test', ownerId: 1 }); db.saveChat('b', { id: -10, type: 'channel' });
  const chat = { id: -20, type: 'supergroup' };
  db.saveMessage('b', { message_id: 10, date: 1791383000, chat, text: 'post', is_automatic_forward: true, forward_origin: { type: 'channel', chat: { id: -10 }, message_id: 42 } });
  db.saveMessage('b', { message_id: 11, date: 1791383001, chat, text: 'intermediate', reply_to_message: { message_id: 10 } });
  db.saveMessage('b', { message_id: 12, date: 1791383002, chat, text: 'interesting', reply_to_message: { message_id: 11 } });
  db.saveMessage('b', { message_id: 13, date: 1791383003, chat, text: 'interesting unrelated' });
  const h = createHistory({ db, access: createAccess(db), key: Buffer.alloc(32) });
  assert.deepEqual(h.search({ botId: 'b', chatId: -20, agentId: 'a' }, { discussion: { chatId: -10, messageId: 42 }, text: ['interesting'] }).messages.map(m => m.messageId), [12]);
});
