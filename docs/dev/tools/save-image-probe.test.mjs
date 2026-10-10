import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImageSaver } from './save-image-probe.mjs';

test('registered images: wiki, own temp, idempotence, boundaries and ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'save-image-check-'));
  try {
    const bot = path.join(root, 'bot');
    const source = path.join(root, 'native.png');
    fs.mkdirSync(bot);
    fs.writeFileSync(source, Buffer.from('image-fixture'));
    const saver = createImageSaver(bot, 'a1');
    assert.throws(() => saver.save('t1', source, 'wiki'), /unregistered/);
    saver.register('t1', source);
    for (const dir of ['.', 'wiki/images', '.temp/a1/generated']) {
      const result = saver.save('t1', source, dir);
      assert.deepEqual(fs.readFileSync(path.join(bot, result.path)), fs.readFileSync(source));
      assert.deepEqual(saver.save('t1', source, dir), result);
    }
    assert.equal(fs.existsSync(source), true);
    assert.throws(() => saver.save('t2', source, 'wiki'), /unregistered/);
    for (const dir of ['../escape', '.git/images', '.temp/a2', '.temp', '.hidden/images', '/tmp/escape']) {
      assert.throws(() => saver.save('t1', source, dir), /destination/);
    }
    fs.symlinkSync(root, path.join(bot, 'escape'), 'dir');
    assert.throws(() => saver.save('t1', source, 'escape/images'), /symlink/);
    fs.symlinkSync(path.join(root, 'missing'), path.join(bot, 'dangling'), 'dir');
    assert.throws(() => saver.save('t1', source, 'dangling/images'), /symlink/);
    fs.writeFileSync(path.join(bot, 'native.png'), 'existing different file');
    assert.throws(() => saver.save('t1', source, '.'), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(bot, 'native.png'), 'utf8'), 'existing different file');
    fs.unlinkSync(path.join(bot, 'wiki/images/native.png'));
    fs.symlinkSync(source, path.join(bot, 'wiki/images/native.png'));
    assert.throws(() => saver.save('t1', source, 'wiki/images'), /symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
