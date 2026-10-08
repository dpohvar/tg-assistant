import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createController } from '../../src/controller.mjs';
test('background failure notifies the origin of an already finished root request', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-agent-error-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'test', ownerId: 1 }); db.setRole('b', 2, 'user');
  let fail; const background = new Promise((_resolve, reject) => { fail = reject; }), scopes = new Map(), notifications = [];
  const c = createController({ db, telegram: { call: async () => ({}) }, agent: { run: async (scope, events) => { scopes.set(scope.chatId, scope); notifications.push(...events.filter(e => e.eventType === 'agent_error')); if (events.some(e => e.eventType === 'agent_message')) return { settled: background }; } } });
  t.after(async () => { c.close(); await c.idle(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  for (const id of [1, 2]) { await c.receive('b', { message: { message_id: 1, date: 1791383000, chat: { id, type: 'private' }, from: { id }, text: 'hello' } }); await c.idle(); }
  await c.invoke(scopes.get(1), 'agent_message', { agentId: scopes.get(2).agentId, text: 'Do work in the background' });
  await new Promise(resolve => setImmediate(resolve));
  fail(new Error('child failed')); await c.idle();
  assert.equal(notifications.length, 1); assert.equal(notifications[0].agentId, scopes.get(2).agentId);
});
test('old background settlement cannot consume an origin from a restarted generation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-origin-generation-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'test', ownerId: 1 }); db.setRole('b', 2, 'user');
  const pending = {}, scopes = new Map(), notifications = [];
  for (const key of ['A', 'B', 'C']) pending[key] = {}; for (const value of Object.values(pending)) value.promise = new Promise((resolve, reject) => Object.assign(value, { resolve, reject }));
  const c = createController({ db, telegram: { call: async () => ({}) }, agent: { run: async (scope, events) => { scopes.set(scope.chatId, scope); notifications.push(...events.filter(e => e.eventType === 'agent_error')); const request = events.find(e => e.eventType === 'agent_message'); if (request) return { settled: pending[request.text].promise }; } } });
  t.after(async () => { for (const value of Object.values(pending)) value.resolve(); c.close(); await c.idle(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  for (const id of [1, 2]) { await c.receive('b', { message: { message_id: 1, date: 1791383000, chat: { id, type: 'private' }, from: { id }, text: 'hello' } }); await c.idle(); }
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const send = async text => { await c.invoke(scopes.get(1), 'agent_message', { agentId: scopes.get(2).agentId, text }); await tick(); };
  await send('A'); await send('B'); pending.A.reject(new Error('A failed')); await tick(); await tick(); assert.equal(notifications.length, 1);
  await send('C'); pending.B.resolve(); await tick(); pending.C.reject(new Error('C failed')); await c.idle(); assert.equal(notifications.length, 2);
});
