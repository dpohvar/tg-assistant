import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentQueue } from '../../src/agents/queue.mjs';
import { Lifecycle } from '../../src/agents/lifecycle.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('ten waiting chat events, schedule outside limit, order and batching', async () => {
  const batches = []; let release;
  const q = new AgentQueue({ dispatch: async (_, events) => { batches.push(events); if (batches.length === 1) await new Promise(r => { release = r; }); } });
  assert.equal(q.enqueue('a1', { n: 0 }, 'chat'), 'accepted'); await tick();
  for (let n = 1; n <= 10; n++) assert.equal(q.enqueue('a1', { n }, 'chat'), 'accepted');
  assert.equal(q.enqueue('a1', { n: 11 }, 'chat'), 'full');
  assert.equal(q.enqueue('a1', { taskId: 't1' }, 'schedule'), 'accepted');
  release(); await q.idle();
  assert.equal(batches.length, 2); assert.equal(batches[1].length, 11);
});
test('waiting root accepts steer, failure discards pending events', async () => {
  const steered = []; let reject;
  const q = new AgentQueue({ dispatch: () => new Promise((_, r) => { reject = r; }), steer: async (_, events) => steered.push(events), onError: () => {} });
  q.enqueue('a1', { n: 1 }, 'chat'); await tick();
  q.setWaiting('a1', true); q.enqueue('a1', { n: 2 }, 'chat'); await tick();
  assert.deepEqual(steered, [[{ n: 2 }]]);
  q.setWaiting('a1', false); q.enqueue('a1', { n: 3 }, 'chat');
  reject(new Error('runtime failed')); await q.idle();
  assert.equal(q.pending('a1'), 0);
});
test('old scope rejected after invalidation or new controller instance', () => {
  const life = new Lifecycle(); const old = life.scope({ agentId: 'a1', botId: 'b1', chatId: 123 });
  life.assertCurrent(old); life.invalidate('a1');
  assert.throws(() => life.assertCurrent(old), /expired/);
  assert.throws(() => new Lifecycle().assertCurrent(old), /expired/);
});
test('a locally expired steer is retried as the next ordinary batch', async () => {
  const batches = []; let finish;
  const q = new AgentQueue({ dispatch: async (_id, events) => { batches.push(events); if (batches.length === 1) await new Promise(resolve => { finish = resolve; }); }, steer: async () => { throw Object.assign(new Error('Root turn finished'), { code: 'steer_expired' }); }, onError: () => assert.fail('Expired steer is not a technical failure') });
  q.enqueue('a', { n: 1 }, 'chat'); await tick();
  q.setWaiting('a', true); q.enqueue('a', { n: 2 }, 'chat'); await tick();
  finish(); await q.idle();
  assert.deepEqual(batches, [[{ n: 1 }], [{ n: 2 }]]);
});
