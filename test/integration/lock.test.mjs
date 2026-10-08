import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock } from '../../src/service/lock.mjs';

test('controller lock refuses a live owner and cannot delete a replacement lock', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lock-')), file = path.join(root, 'lock');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = acquireLock(file);
  assert.throws(() => acquireLock(file), /running/);
  fs.unlinkSync(file);
  const replacement = acquireLock(file);
  release(); assert.equal(fs.existsSync(file), true);
  replacement(); assert.equal(fs.existsSync(file), false);
});
test('a concurrent stale-lock recovery guard prevents lock replacement', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lock-')), file = path.join(root, 'lock');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(file, '2147483647'); fs.writeFileSync(file + '.reclaim', 'another-reclaimer');
  assert.throws(() => acquireLock(file), /recovery/);
  assert.equal(fs.readFileSync(file, 'utf8'), '2147483647');
});
