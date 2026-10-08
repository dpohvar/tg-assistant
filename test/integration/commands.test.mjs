import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createCommands, range } from '../../src/commands/router.mjs';
test('admin cannot appoint admin; command error is a reply, range accepts single N', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-commands-')), db = openDatabase(path.join(root, 'db.sqlite')); t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b1', telegramId: 42, username: 'test', ownerId: 1 }); db.setRole('b1', 2, 'admin');
  const calls = []; const commands = createCommands({ db, config: { dataDir: root }, telegram: { call: async (...a) => calls.push(a) } });
  await commands.handle('b1', { message_id: 5, chat: { id: 2, type: 'private' }, from: { id: 2 }, text: '/set_user 3 admin' });
  assert.equal(db.role('b1', 3), null); assert.equal(calls[0][2].reply_parameters.message_id, 5);
  assert.deepEqual(range('5'), [4, 5]); assert.throws(() => range('five'));
});
test('leave replies in the current group before leaving it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-leave-')), db = openDatabase(path.join(root, 'db.sqlite'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b1', telegramId: 42, username: 'test', ownerId: 1 }); db.saveChat('b1', { id: -1, type: 'group' }); db.ensureAgent('b1', -1);
  const order = [];
  const commands = createCommands({ db, config: { dataDir: root }, telegram: { call: async () => { order.push('reply'); } }, stopAgent: async () => { order.push('leave'); } });
  await commands.handle('b1', { message_id: 5, chat: { id: -1, type: 'group' }, from: { id: 1 }, text: '/leave' });
  assert.deepEqual(order, ['reply', 'leave']);
});
test('sensitive private commands in a group are handled without reaching agent history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-secret-command-')), db = openDatabase(path.join(root, 'db.sqlite'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b', telegramId: 42, username: 'test', ownerId: 1 });
  const calls = [], commands = createCommands({ db, config: { dataDir: root }, telegram: { call: async (_bot, method) => { calls.push(method); return {}; } } });
  assert.equal(await commands.handle('b', { message_id: 1, chat: { id: -1, type: 'group' }, from: { id: 1 }, text: '/git_setup main https://example.com/wiki.git placeholder-secret' }), true);
  assert.deepEqual(calls, ['sendMessage', 'deleteMessage']);
});

test('agents formats IDs/types and public chat IDs with pagination',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});
 db.saveChat('b',{id:1,type:'private',first_name:'Person',username:'person'});db.ensureAgent('b',1);
 db.saveChat('b',{id:-2,type:'group',title:'Group 😀'});db.ensureAgent('b',-2);
 const replies=[];const router=createCommands({db,config:{},telegram:{call:async(_b,_m,a)=>replies.push(a)}});
 await router.handle('b',{message_id:1,chat:{id:1,type:'private'},from:{id:1},text:'/agents'});
 const r=replies.at(-1);assert.match(r.text,/^1-2 \/ 2\n/);assert.match(r.text,/@person/);assert.match(r.text,/Group 😀 -2/);
 const formatted=r.entities.map(e=>[e.type,r.text.slice(e.offset,e.offset+e.length)]);assert.equal(formatted.filter(e=>e[0]==='code').length,2);assert.ok(formatted.some(e=>e[0]==='italic'&&e[1]==='-2'));assert.ok(!formatted.some(e=>e[0]==='italic'&&e[1]==='1'));
 await router.handle('b',{message_id:2,chat:{id:1,type:'private'},from:{id:1},text:'/agents 2'});assert.match(replies.at(-1).text,/^2-2 \/ 2\n/);
});
