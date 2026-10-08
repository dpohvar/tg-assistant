import test from 'node:test';
import assert from 'node:assert/strict';
import { Pollers } from '../../src/service/pollers.mjs';

test('shutdown awaits dynamically registered pollers including in-flight receive', async () => {
  let finish;
  const receiving = new Promise(resolve => { finish = resolve; });
  const registry = new Pollers(async (_id, signal) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    await receiving;
  });
  registry.start('first'); registry.start('added-later');
  let closed = false;
  const closing = registry.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.equal(registry.start('after-stop'), false);
  finish(); await closing; assert.equal(closed, true);
});

test('removing a bot awaits its current poller before allowing restart', async () => {
  let finish;
  const registry = new Pollers(async (_id, signal) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    await new Promise(resolve => { finish = resolve; });
  });
  registry.start('bot');
  const removing = registry.remove('bot');
  assert.equal(registry.start('bot'), false);
  await new Promise(resolve => setImmediate(resolve)); finish(); await removing;
  assert.equal(registry.start('bot'), true);
  const closing = registry.close(); await new Promise(resolve => setImmediate(resolve)); finish(); await closing;
});
