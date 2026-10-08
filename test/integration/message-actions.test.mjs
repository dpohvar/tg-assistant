import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessages } from '../../src/messages/actions.mjs';
import { permitsAllow, parseCallback, closeButtons, richInput } from '../../src/messages/callbacks.mjs';
test('controller rich button edits preserve gallery file IDs in Telegram input format', () => {
  const saved = { rich_message: { blocks: [{ type: 'slideshow', blocks: [{ type: 'photo', photo: [{ file_id: 'small', width: 100, height: 100 }, { file_id: 'large', width: 800, height: 600 }] }] }, { type: 'buttons', buttons: [{ text: '⬜️ Choose', callback_data: '[g]yes' }] }] } };
  const changed = closeButtons(saved, 'g', '[g]yes');
  const input = richInput(changed.rich_message);
  assert.deepEqual(input.blocks[0].blocks[0].photo, { type: 'photo', media: 'large' });
  assert.equal(input.blocks[1].buttons[0].text, '✅ Choose');
  assert.deepEqual(input.blocks[1].buttons[0].disabled, {});
  assert.equal(saved.rich_message.blocks[1].buttons[0].text, '⬜️ Choose');
});
test('native transfer fields cannot override the checked source or destination', async () => {
  let sent;
  const messages = createMessages({ db: {}, access: { assertWrite() {}, assertRead() {} }, assertCurrent() {}, telegram: { call: async (_bot, _method, args) => { sent = args; return { message_id: 8 }; } } });
  await messages.transfer({ botId: 'b', chatId: 1 }, 'copy', { fromChatId: 2, messageIds: [3], chat_id: 99, from_chat_id: 98, message_id: 97 });
  assert.equal(sent.chat_id, 1); assert.equal(sent.from_chat_id, 2); assert.equal(sent.message_id, 3);
});
test('sending a file requires provenance in an accessible outer message', async () => {
  let calls = 0;
  const messages = createMessages({ db: { getMessage: () => ({ document: { file_id: 'allowed' } }), saveMessage() {} }, access: { assertWrite() {}, assertRead(_scope, id) { if (id === 9) throw new Error('denied'); } }, assertCurrent() {}, telegram: { call: async () => { calls++; return { message_id: 8 }; } } });
  const scope = { botId: 'b', chatId: 1 };
  assert.equal((await messages.send(scope, { document: 'stolen' })).error, 'file_not_accessible');
  assert.equal((await messages.send(scope, { document: 'stolen', file_sources: [{ messageId: 2, fileId: 'stolen' }] })).error, 'file_not_accessible');
  assert.equal((await messages.send(scope, { document: 'allowed', file_sources: [{ chatId: 9, messageId: 2, fileId: 'allowed' }] })).error, 'file_not_accessible');
  assert.equal(calls, 0);
  assert.deepEqual(await messages.send(scope, { document: 'allowed', file_sources: [{ messageId: 2, fileId: 'allowed' }] }), { messageIds: [8] });
  assert.deepEqual(await messages.send(scope, { media: [{ type: 'photo', media: 'allowed', caption: 'This is a caption, not a file ID' }], file_sources: [{ messageId: 2, fileId: 'allowed' }] }), { messageIds: [8] });
  assert.deepEqual(await messages.send(scope, { rich_message: { html: '<img src="tg://photo?id=one"/>', media: [{ id: 'one', media: { type: 'photo', media: 'allowed' } }] }, file_sources: [{ messageId: 2, fileId: 'allowed' }] }), { messageIds: [8] });
});
test('confirmed Telegram result survives storage failure without a retry', async () => {
  const calls = [];
  const messages = createMessages({ db: { saveMessage: () => { throw new Error('disk'); } }, access: { assertWrite() {} }, assertCurrent() {}, telegram: { call: async (...args) => { calls.push(args); return { message_id: 7 }; } } });
  const result = await messages.send({ botId: 'b', chatId: 1 }, { text: 'hello' });
  assert.equal(result.error, 'storage_failed'); assert.deepEqual(result.messageIds, [7]); assert.equal(calls.length, 1);
});
test('edit accepts InputMedia and updates media with its caption in one component', async () => {
  const calls = [], old = { message_id: 4, chat: { id: 1 }, photo: [{ file_id: 'old' }] };
  const messages = createMessages({ db: { getMessage: () => old, saveMessage() {} }, access: { assertWrite() {}, assertRead() {} }, assertCurrent() {}, telegram: { call: async (_bot, method, body) => { calls.push({ method, body }); return old; } } });
  const result = await messages.edit({ botId: 'b', chatId: 1 }, { messageId: 4, media: { type: 'photo', media: 'https://example.com/photo.png', caption: 'new caption', parse_mode: 'HTML' } });
  assert.deepEqual(result.updated, ['photo']); assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'editMessageMedia'); assert.equal(calls[0].body.media.caption, 'new caption'); assert.equal(calls[0].body.media.parse_mode, 'HTML');
});
test('callback group parser and longest-prefix permits', () => {
  assert.deepEqual(parseCallback('[cancel]cancel'), { group: 'cancel', key: 'cancel' });
  assert.throws(() => parseCallback('[bad]'));
  assert.equal(permitsAllow({ '*': null, '[x]*': [1], '[x]no': [] }, '[x]no', 1), false);
  assert.equal(permitsAllow({ '*': null, '[x]*': [1] }, '[x]yes', 2), false);
});
test('single copy reconstructs known content without private provenance and saves permits', async () => {
  let saved, permits;
  const source = { message_id: 2, date: 1, chat: { id: 1, type: 'private' }, from: { id: 1, first_name: 'Private user' }, photo: [{ file_id: 'photo', width: 10, height: 10 }], caption: 'old', media_group_id: 'old-album', forward_origin: { type: 'user', sender_user: { id: 1 } }, reply_to_message: { message_id: 1 }, reply_markup: { inline_keyboard: [[{ text: 'Old', callback_data: 'old' }]] } };
  const db = { getMessage: () => source, getChat: () => ({ json: JSON.stringify({ id: -2, type: 'supergroup' }) }), getBot: () => ({ telegramId: 42, username: 'test' }), saveMessage: (_bot, message) => { saved = message; }, sql: { prepare: () => ({ run: (...args) => { permits = args.at(-1); } }) } };
  const messages = createMessages({ db, access: { assertWrite() {}, assertRead() {} }, assertCurrent() {}, telegram: { call: async () => ({ message_id: 8 }) } });
  const permissions = { '*': [1] }, keyboard = { inline_keyboard: [[{ text: 'New', callback_data: 'new' }]] };
  const result = await messages.transfer({ botId: 'b', chatId: 1 }, 'copy', { chatId: -2, messageIds: [2], caption: 'new', reply_markup: keyboard, permits: permissions });
  assert.deepEqual(result.messageIds, [8]); assert.equal(saved?.message_id, 8); assert.equal(saved.chat.id, -2); assert.equal(saved.from.id, 42);
  assert.equal(saved.caption, 'new'); assert.equal(saved.reconstructed, true); assert.deepEqual(saved.reply_markup, keyboard);
  for (const field of ['forward_origin', 'reply_to_message', 'media_group_id']) assert.equal(saved[field], undefined, field);
  assert.equal(permits, JSON.stringify(permissions));
});

test('send returns the sanitized Telegram rejection detail',async()=>{
 const m=createMessages({db:{},access:{assertWrite(){}},assertCurrent(){},telegram:{call:async()=>{throw Object.assign(new Error('Bad Request: invalid rich block'),{code:'telegram_api_error'});}}});
 const r=await m.send({botId:'b',chatId:1},{rich_message:{blocks:[]}});assert.match(r.description,/invalid rich block/);
});

test('permits-only edit is local, fenced, and reports storage failures', async () => {
  let saved, calls = 0, fenced = false, disk = false;
  const m = createMessages({ db: { getMessage: () => ({ text: 'hello' }), sql: { prepare: () => ({ run: (...args) => { if (disk) throw new Error('disk'); saved = args.at(-1); } }) } }, access: { assertWrite() {} }, assertCurrent() { if (fenced) throw new Error('stale'); }, assertTarget() {}, telegram: { call() { calls++; } } });
  const scope = { botId: 'b', chatId: 1 }, payload = { messageId: 2, permits: { '*': [] } };
  assert.deepEqual(await m.edit(scope, payload), { messageId: 2, updated: ['permits'] });
  assert.equal(saved, JSON.stringify(payload.permits)); assert.equal(calls, 0);
  fenced = true; await assert.rejects(m.edit(scope, payload), /stale/);
  fenced = false; disk = true; assert.equal((await m.edit(scope, payload)).error, 'storage_failed');
});
test('media replacement preserves omitted caption and resets formatting for explicit captions', async () => {
  let sent, calls = 0;
  const old = { photo: [{ file_id: 'old' }], caption: 'old caption', caption_entities: [{ type: 'bold', offset: 0, length: 3 }] };
  const m = createMessages({ db: { getMessage: () => old, saveMessage() {} }, access: { assertWrite() {} }, assertCurrent() {}, telegram: { async call(_b, _method, args) { sent = args.media; calls++; return old; } } });
  const scope = { botId: 'b', chatId: 1 }, media = { type: 'photo', media: 'https://example.com/new.png' };
  await m.edit(scope, { messageId: 1, media }); assert.equal(sent.caption, old.caption); assert.deepEqual(sent.caption_entities, old.caption_entities);
  for (const caption of ['new', '']) { await m.edit(scope, { messageId: 1, media: { ...media, caption } }); assert.equal(sent.caption, caption); assert.equal(sent.caption_entities, undefined); }
  const before = calls;
  assert.equal((await m.edit(scope, { messageId: 1, media, caption: 'ambiguous' })).error, 'invalid_argument'); assert.equal(calls, before);
});
