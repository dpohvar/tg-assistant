import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlbumCollector } from '../../src/telegram/albums.mjs';
test('late parts of an activated album do not become a new direct trigger', () => {
  const calls = []; let callback;
  const collector = new AlbumCollector({ onReady: (...args) => { calls.push(args); return true; }, setTimer: fn => { callback = fn; return 1; }, clearTimer() {} });
  collector.add('album', { message_id: 1 }, true); callback();
  collector.add('album', { message_id: 2 }, false); callback();
  assert.equal(calls[0][1], true);
  assert.equal(calls[1][1], false);
  assert.equal(calls[1][2], true);
  collector.close();
});
