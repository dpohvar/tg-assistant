import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RpcProcess } from '../../src/codex/rpc.mjs';
test('RPC correlates requests, notifications and rejects unattended approvals', async t => {
  const rpc = new RpcProcess({ executable: process.execPath, args: ['test/fixtures/rpc-server.mjs'], cwd: process.cwd(), env: process.env });
  t.after(() => rpc.close());
  assert.deepEqual(await rpc.request('echo', { n: 1 }), { n: 1 });
  const notification = rpc.waitFor(m => m.method === 'changed');
  await rpc.request('trigger'); assert.equal((await notification).params.value, 1);
  const rejection = rpc.waitFor(m => m.method === 'rejected');
  await rpc.request('permission'); await rejection;
});
