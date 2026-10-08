import test from 'node:test';
import assert from 'node:assert/strict';
import { shortMessage } from '../../src/telegram/short-message.mjs';
test('short audio includes known duration and metadata; service is explicitly recognizable', () => {
  const base = { message_id: 1, date: 1000 };
  assert.deepEqual(shortMessage({ ...base, audio: { file_name: 'song.mp3', duration: 180, title: 'Song', performer: 'Singer' } }), { eventType: 'message', messageId: 1, date: '1970-01-01T00:16:40.000Z', audio: 'song.mp3', duration: 180, title: 'Song', performer: 'Singer' });
  assert.equal(shortMessage({ ...base, new_chat_members: [{ id: 5 }] }).service, 'new_chat_members');
});
