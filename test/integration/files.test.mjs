import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BotFiles } from '../../src/files/paths.mjs';
test('files permit wiki and own temp, deny traversal, git and another agent temp', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-files-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = new BotFiles(root, 'a1');
  files.write('wiki/a.txt', Buffer.from('hello')); assert.equal(files.read('wiki/a.txt').toString(), 'hello');
  files.write('.temp/a1/generated/image.png', Buffer.from('image'));
  for (const p of ['../secret', '.git/config', '.temp/a2/file']) assert.throws(() => files.read(p));
  assert.throws(() => files.saveImage('t1', path.join(root, 'unknown.png'), 'wiki'));
  const source = path.join(root, 'wiki/a.txt'); files.registerImage('t1', source);
  assert.equal(files.saveImage('t1', source, 'wiki/images').path, 'wiki/images/a.txt');
  assert.equal(files.saveImage('parent', source, 'wiki/parent').path, 'wiki/parent/a.txt');
  assert.throws(() => files.saveImage('t1', source, path.join(root, 'wiki', 'absolute')));
});
