import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTemp } from '../../src/files/cleanup.mjs';
test('cleanup expires by mtime and does not follow symlinks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-clean-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.temp', 'a1'), { recursive: true });
  const old = path.join(root, '.temp', 'a1', 'old'), fresh = path.join(root, '.temp', 'a1', 'fresh');
  fs.writeFileSync(old, 'old'); fs.writeFileSync(fresh, 'fresh'); fs.utimesSync(old, new Date(0), new Date(0));
  cleanTemp(root);
  assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(fresh), true);
});
test('Linux cleanup pins directories when a checked child is replaced with a symlink', { skip: process.platform !== 'linux' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-clean-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.temp', 'a1'), { recursive: true }); fs.mkdirSync(path.join(root, 'outside'));
  const victim = path.join(root, 'outside', 'important'); fs.writeFileSync(victim, 'keep'); fs.utimesSync(victim, new Date(0), new Date(0));
  const lstat = fs.lstatSync; let swapped = false;
  fs.lstatSync = function (file, ...args) {
    const stat = lstat.call(fs, file, ...args);
    if (!swapped && String(file).endsWith('/a1')) { swapped = true; fs.renameSync(path.join(root, '.temp', 'a1'), path.join(root, 'parked')); fs.symlinkSync(path.join(root, 'outside'), path.join(root, '.temp', 'a1')); }
    return stat;
  };
  try { cleanTemp(root); } finally { fs.lstatSync = lstat; }
  assert.equal(swapped, true); assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
});
