import test from 'node:test';
import assert from 'node:assert/strict';
import { BotGate } from '../../src/service/bot-gate.mjs';
import { AgentQueue } from '../../src/agents/queue.mjs';

test('exclusive directory replacement waits for existing file operations and refuses new ones', async () => {
  const gate = new BotGate(); let finish;
  const operation = gate.run('b', () => new Promise(resolve => { finish = resolve; }));
  let entered = false;
  const locking = gate.acquire('b', async () => {}).then(release => { entered = true; return release; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(entered, false);
  await assert.rejects(gate.run('b', async () => {}), /maintenance/);
  await assert.rejects(gate.acquire('b', async () => {}), /maintenance/);
  finish(); await operation; const release = await locking;
  await assert.rejects(gate.run('b', async () => {}), /maintenance/);
  release(); assert.equal(await gate.run('b', async () => 'ok'), 'ok');
});
test('paused agents retain incoming events and resume them after directory replacement', async () => {
  const delivered = [], queue = new AgentQueue({ dispatch: async (_id, events) => delivered.push(events) });
  queue.setPaused('a', true);
  queue.enqueue('a', { messageId: 1 }, 'chat');
  await queue.idle(); assert.equal(delivered.length, 0);
  queue.setPaused('a', false); await queue.idle();
  assert.deepEqual(delivered, [[{ messageId: 1 }]]);
});
test('intentional interruption of steer preserves messages received while paused', async () => {
  let finishRoot, rejectSteer;
  const queue = new AgentQueue({ dispatch: () => new Promise(resolve => { finishRoot = resolve; }), steer: () => new Promise((_resolve, reject) => { rejectSteer = reject; }) });
  queue.enqueue('a', { messageId: 1 }, 'chat'); await new Promise(resolve => setImmediate(resolve));
  queue.setWaiting('a', true); queue.enqueue('a', { messageId: 2 }, 'chat'); await new Promise(resolve => setImmediate(resolve));
  queue.setPaused('a', true); queue.enqueue('a', { messageId: 3 }, 'chat');
  rejectSteer(Object.assign(new Error('Interrupted for directory replacement'), { code: 'rules_replaced' }));
  finishRoot(); await queue.idleAgent('a');
  assert.equal(queue.pending('a'), 1);
  queue.close();
});
