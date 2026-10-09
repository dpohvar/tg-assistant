import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createController } from '../../src/controller.mjs';

test('removing a private user deletes the dialog and makes previously issued scopes unusable', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-revoke-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 }); db.setRole('b', 2, 'user');
  db.saveMessage('b', { message_id: 1, date: 1000, chat: { id: 2, type: 'private' }, from: { id: 2 }, text: 'private' });
  const old = db.ensureAgent('b', 2), deleted = [];
  const c = createController({ db, config: { dataDir: root, botsDir: path.join(root, 'bots') }, telegram: { call: async () => ({}) }, agent: { deleteSession: async id => deleted.push(id) } });
  t.after(() => { c.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const scope = c.lifecycle.scope(old); c.scheduler.timers = false;
  c.scheduler.schedule(old, { at: '2027-01-01T00:00:00Z', description: 'private', text: 'private work' });
  await c.receive('b', { message: { message_id: 5, date: 1000, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/user delete 2' } });
  assert.equal(db.role('b', 2), null); assert.equal(db.getChat('b', 2), null);
  assert.equal(db.agent('b', 2), null); assert.equal(db.getMessage('b', 2, 1), null);
  assert.deepEqual(deleted, [old.agentId]);
  await assert.rejects(c.invoke(scope, 'time', {}), /expired/);
});
test('unblocking a private bot does not leave the chat or recreate an agent', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-unblock-')), db = openDatabase(path.join(root, 'db.sqlite')), calls = [];
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 }); db.setRole('b', 2, 'user');
  const c = createController({ db, telegram: { call: async (_bot, method) => calls.push(method) }, agent: {} });
  t.after(() => { c.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await c.receive('b', { my_chat_member: { chat: { id: 2, type: 'private' }, from: { id: 2 }, new_chat_member: { status: 'member' } } });
  assert.deepEqual(calls, []); assert.equal(db.agent('b', 2), null); assert.equal(db.getChat('b', 2), null);
});
