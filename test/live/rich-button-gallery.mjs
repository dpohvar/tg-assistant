import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createTelegram } from '../../src/telegram/api.mjs';
import { closeButtons, richInput } from '../../src/messages/callbacks.mjs';

// Bounded live test; no polling, no credentials in output or repository.
const [tokenFile, fixtureFile, recipient] = process.argv.slice(2);
if (!tokenFile || !fixtureFile || !/^\d+$/.test(recipient ?? '')) throw new Error('Usage: node test/live/rich-button-gallery.mjs TOKEN_FILE CAROUSEL_FIXTURE RECIPIENT_ID');
const telegram = createTelegram({ getToken: async () => fs.readFileSync(tokenFile, 'utf8').trim() });
const photos = JSON.parse(fs.readFileSync(fixtureFile, 'utf8')).photos;
assert.ok(photos.length >= 2);
const sent = await telegram.call('test', 'sendRichMessage', {
  chat_id: Number(recipient),
  rich_message: { blocks: [
    { type: 'paragraph', text: 'Проверка контроллерного редактирования rich-кнопки: фотографии должны сохраниться.' },
    { type: 'slideshow', blocks: photos.map(photo => ({ type: 'photo', photo: { type: 'photo', media: photo.file_id } })) },
    { type: 'buttons', buttons: [{ text: '⬜️ Выбор', callback_data: '[gallery]ok' }] },
  ] },
});
const changed = closeButtons(sent, 'gallery', '[gallery]ok');
const edited = await telegram.call('test', 'editMessageText', { chat_id: Number(recipient), message_id: sent.message_id, rich_message: richInput(changed.rich_message) });
const retained = edited.rich_message.blocks.find(block => block.type === 'slideshow').blocks;
assert.equal(retained.length, photos.length);
assert.deepEqual(retained.map(block => block.photo.at(-1).file_id), photos.map(photo => photo.file_id));
const closedButton = edited.rich_message.blocks.find(block => block.type === 'buttons').buttons[0];
assert.equal(closedButton.text, '✅ Выбор');
assert.deepEqual(closedButton.disabled, {});
assert.equal(closedButton.callback_data, undefined);
console.log(JSON.stringify({ messageId: edited.message_id, photos: retained.length, edited: true }));
