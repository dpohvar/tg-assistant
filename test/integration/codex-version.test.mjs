import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCodexVersion } from '../../src/codex/version.mjs';
test('an unvalidated CLI version warns without preventing startup', async () => {
  const warnings = [];
  await verifyCodexVersion(process.execPath, warning => warnings.push(warning));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /0\.159\.3/);
  assert.match(warnings[0], /continuing/i);
});
test('an unavailable CLI still fails startup', async () => {
  await assert.rejects(verifyCodexVersion('nonexistent-codex-test-executable'), { code: 'ENOENT' });
});
