import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegram } from '../../src/telegram/api.mjs';
import { poll } from '../../src/telegram/polling.mjs';
test('Telegram errors omit URL and token; failed request is not retried', async () => {
  let count = 0;
  const tg = createTelegram({ getToken: () => 'secret-token', fetch: async () => { count++; throw new Error('https://api.telegram.org/botsecret-token/sendMessage'); } });
  await assert.rejects(tg.call('b1', 'sendMessage', { text: 'x' }), error => !error.message.includes('secret-token') && error.code === 'telegram_transport_failed');
  assert.equal(count, 1);
});
test('polling advances after admission and stops without replaying duplicates', async () => {
  let offset = 0, calls = 0; const seen = []; const ac = new AbortController();
  const tg = { async call(_, method, args) { calls++; assert.equal(method, 'getUpdates'); assert.equal(args.offset, offset); return [{ update_id: 3 }, { update_id: 4 }]; } };
  await poll({ botId: 'b1', telegram: tg, signal: ac.signal, getOffset: () => offset, setOffset: value => { offset = value; if (value === 5) ac.abort(); }, receive: async (_, e) => seen.push(e.update_id) });
  assert.deepEqual(seen, [3, 4]); assert.equal(offset, 5); assert.equal(calls, 1);
});
