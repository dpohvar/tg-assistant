import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createController } from '../../src/controller.mjs';
import { dynamicTools } from '../../src/codex/threads.mjs';

const sticker = (id, format = 'static', fileId = `file-${id}`) => ({
  file_id: fileId, file_unique_id: `unique-${id}`, type: 'custom_emoji',
  custom_emoji_id: id, width: 100, height: 100,
  is_animated: format === 'tgs', is_video: format === 'webm', emoji: '🙂',
  thumbnail: { file_id: `thumb-${id}`, file_unique_id: `thumb-unique-${id}`, width: 100, height: 100 },
});

function fixture(t, { lookup, badFile } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-custom-emoji-'));
  const db = openDatabase(':memory:'), calls = [], fetched = [], errors = [];
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 });
  db.saveChat('b', { id: 1, type: 'private' });
  const own = db.ensureAgent('b', 1);
  t.mock.method(globalThis, 'fetch', async url => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => Buffer.from(`bytes:${new URL(url).pathname.split('/').at(-1)}`) };
  });
  const telegram = {
    getToken: () => 'synthetic-token',
    async call(botId, method, args) {
      calls.push({ botId, method, args });
      if (method === 'getCustomEmojiStickers') return lookup ? lookup(args.custom_emoji_ids) : args.custom_emoji_ids.map(id => sticker(id));
      if (method === 'getFile') {
        if (args.file_id === badFile) throw new Error('synthetic-token must stay private');
        return { file_path: `stickers/${args.file_id}` };
      }
      throw new Error(`Unexpected Telegram call: ${method}`);
    },
  };
  const controller = createController({ db, telegram, agent: {}, config: { botsDir: root }, onError: error => errors.push(error) });
  t.after(async () => {
    controller.close(); await controller.idle(); db.close();
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const scope = controller.lifecycle.scope(own);
  const download = customEmojiIds => controller.invoke(scope, 'download_custom_emoji', { customEmojiIds });
  return { root, db, calls, fetched, controller, scope, download };
}

test('custom emoji downloads match metadata by ID and preserve input order and duplicates', async t => {
  const id = '9007199254740993123';
  const animated = sticker(id, 'tgs'), video = sticker('2', 'webm');
  const f = fixture(t, { lookup: () => [video, animated] });
  const result = await f.download([id, '2', id]);
  assert.deepEqual(result.files.map(file => file.customEmojiId), [id, '2', id]);
  assert.deepEqual(result.files.map(file => file.fileId), [`file-${id}`, 'file-2', `file-${id}`]);
  assert.deepEqual(result.files[0].sticker, animated);
  assert.deepEqual(result.files[1].sticker, video);
  assert.equal(fs.readFileSync(result.files[0].path, 'utf8'), `bytes:file-${id}`);
  assert.equal(fs.readFileSync(result.files[1].path, 'utf8'), 'bytes:file-2');
  assert.equal(result.files[0].path, result.files[2].path);
  assert.deepEqual(f.calls[0], { botId: 'b', method: 'getCustomEmojiStickers', args: { custom_emoji_ids: [id, '2'] } });
  assert.equal(f.fetched.length, 2);
  const cached = await f.controller.invoke(f.scope, 'download', { fileIds: [`file-${id}`] });
  assert.equal(cached.files[0].path, result.files[0].path);
  assert.equal(f.fetched.length, 2);
});

test('missing emoji metadata and failed downloads do not discard successful items', async t => {
  const f = fixture(t, { lookup: () => [sticker('bad'), sticker('good')], badFile: 'file-bad' });
  const result = await f.download(['missing', 'bad', 'good']);
  assert.deepEqual(result.files.map(file => file.error), ['custom_emoji_unavailable', 'file_unavailable', undefined]);
  assert.equal(result.files[0].path, undefined);
  assert.equal(result.files[1].fileId, 'file-bad');
  assert.equal(result.files[1].sticker.custom_emoji_id, 'bad');
  assert.equal(fs.readFileSync(result.files[2].path, 'utf8'), 'bytes:file-good');
  assert.ok(!JSON.stringify(result).includes('synthetic-token'));
});

test('custom emoji lookup failure returns a sanitized error for each requested item', async t => {
  const f = fixture(t, { lookup: () => { throw new Error('https://api.telegram.org/botsynthetic-token/private'); } });
  const result = await f.download(['1', '2']);
  assert.deepEqual(result.files.map(file => [file.customEmojiId, file.error]), [
    ['1', 'custom_emoji_unavailable'], ['2', 'custom_emoji_unavailable'],
  ]);
  assert.ok(!JSON.stringify(result).includes('synthetic-token'));
  assert.equal(f.fetched.length, 0);
});

test('custom emoji requests reject invalid IDs and batches over the Telegram limit before lookup', async t => {
  const f = fixture(t);
  for (const customEmojiIds of [undefined, null, '1', [], [1], [''], [null], new Array(1), Array(201).fill('1')]) {
    assert.equal((await f.download(customEmojiIds)).error, 'invalid_argument');
  }
  assert.equal(f.calls.length, 0);
  const ids = Array.from({ length: 200 }, (_, i) => String(i + 1));
  assert.equal((await f.download(ids)).files.length, 200);
  assert.equal(f.calls[0].args.custom_emoji_ids.length, 200);
});

test('custom emoji download caches stay isolated by agent and stale scopes cannot call Telegram', async t => {
  const f = fixture(t);
  const first = (await f.download(['1'])).files[0];
  f.db.saveChat('b', { id: -1, type: 'group', title: 'Group' });
  const other = f.controller.lifecycle.scope(f.db.ensureAgent('b', -1));
  const second = (await f.controller.invoke(other, 'download_custom_emoji', { customEmojiIds: ['1'] })).files[0];
  assert.notEqual(first.path, second.path);
  assert.equal(f.fetched.length, 2);
  assert.ok(first.path.includes(`/.temp/${f.scope.agentId}/download/`));
  assert.ok(second.path.includes(`/.temp/${other.agentId}/download/`));
  const count = f.calls.length;
  f.controller.lifecycle.invalidate(f.scope.agentId);
  await assert.rejects(f.download(['2']), { code: 'connection_expired' });
  assert.equal(f.calls.length, count);
});

test('custom emoji download is available through the agent tool schema', () => {
  const tool = dynamicTools.find(item => item.name === 'download_custom_emoji');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['customEmojiIds']);
  assert.deepEqual(tool.inputSchema.properties.customEmojiIds, {
    type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', minLength: 1 },
  });
});
