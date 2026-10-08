const kinds = { text: 'sendMessage', rich_message: 'sendRichMessage', photo: 'sendPhoto', document: 'sendDocument', video: 'sendVideo', animation: 'sendAnimation', audio: 'sendAudio', voice: 'sendVoice', sticker: 'sendSticker', location: 'sendLocation', venue: 'sendVenue', contact: 'sendContact', poll: 'sendPoll', dice: 'sendDice', video_note: 'sendVideoNote', media: 'sendMediaGroup' };
import { findFile } from '../files/download.mjs';
const fail = (error, description, extra = {}) => ({ ...extra, error, description });
const mediaFields = new Set(['photo', 'document', 'video', 'animation', 'audio', 'voice', 'sticker', 'video_note', 'media', 'cover']);
function mediaReferences(body) {
  const refs = [];
  const visit = (value, media = false) => {
    if (typeof value === 'string') { if (media) refs.push(value); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, media); return; }
    for (const [key, item] of Object.entries(value)) visit(item, mediaFields.has(key));
  };
  for (const [key, value] of Object.entries(body)) if (mediaFields.has(key) || key === 'rich_message') visit(value, mediaFields.has(key));
  return refs;
}
const type = m => Object.keys(kinds).filter(k => k !== 'media').find(k => m[k] !== undefined);
export function createMessages({ db, access, assertCurrent, assertTarget = () => {}, telegram, uploads = async () => [] }) {
  const validateFiles = (scope, body, sources, local) => {
    try {
      for (const id of mediaReferences(body)) {
        if (/^https?:\/\//i.test(id)) { if (/^https?:\/\/api\.telegram\.org\/(?:file\/)?bot/i.test(id)) throw new Error('Secret URL'); continue; }
        if (id.startsWith('attach://')) { if (!Object.hasOwn(local ?? {}, id.slice(9))) throw new Error('Missing upload'); continue; }
        const candidates = (sources ?? []).filter(s => s.fileId === id);
        if (!candidates.some(s => { try { const chatId = s.chatId ?? scope.chatId; access.assertRead(scope, chatId); return Boolean(findFile(db.getMessage(scope.botId, chatId, s.messageId), id)); } catch { return false; } })) throw new Error('Inaccessible file');
      }
    } catch { return fail('file_not_accessible', 'Every Telegram file ID requires an accessible saved outer message in file_sources; uploads require a declared local attachment.'); }
  };
  const savePermits = (scope, chatId, messageId, permits) => { if (permits !== undefined) db.sql.prepare('INSERT INTO button_state(botId,chatId,messageId,permits) VALUES(?,?,?,?) ON CONFLICT(botId,chatId,messageId) DO UPDATE SET permits=excluded.permits').run(scope.botId, chatId, messageId, JSON.stringify(permits)); };
  const call = async (scope, method, args, files) => { assertCurrent(scope); access.assertWrite(scope, args.chat_id); assertTarget(scope, args.chat_id); return telegram.call(scope.botId, method, args, { uploads: files }); };
  const apiError = e => e.code === 'telegram_transport_failed' ? fail('delivery_unknown', 'Telegram confirmation was not received. Do not repeat automatically; the action may have completed.') : fail(e.code ?? 'telegram_failed', e.code === 'telegram_api_error' ? String(e.message).slice(0, 1000) : 'Telegram rejected the request. Check the fields and bot permissions before retrying.');
  return {
    async send(scope, payload) {
      const { chatId = scope.chatId, permits, uploads: local, file_sources, ...body } = payload;
      access.assertWrite(scope, chatId);
      const present = Object.keys(kinds).filter(k => body[k] !== undefined);
      if (present.length !== 1) return fail('invalid_argument', 'Specify exactly one supported message content field.');
      const kind = present[0]; if (kind === 'media' && (body.reply_markup || permits)) return fail('invalid_argument', 'Albums cannot contain inline buttons or permits. Send buttons in a separate message.');
      const fileError = validateFiles(scope, body, file_sources, local); if (fileError) return fileError;
      if (body.reply_parameters?.chat_id) access.assertRead(scope, body.reply_parameters.chat_id);
      if (kind === 'location' || kind === 'venue' || kind === 'contact' || kind === 'poll' || kind === 'dice') { Object.assign(body, body[kind]); delete body[kind]; }
      const files = await uploads(scope, local, file_sources);
      let sent; try { sent = await call(scope, kinds[kind], { ...body, chat_id: chatId }, files); } catch (e) { return apiError(e); }
      const results = Array.isArray(sent) ? sent : [sent], messageIds = results.map(m => m.message_id);
      try { for (const m of results) { db.saveMessage(scope.botId, m); savePermits(scope, chatId, m.message_id, permits); } }
      catch { return fail('storage_failed', 'Telegram sent the message, but local storage failed. Do not resend.', { messageIds }); }
      return { messageIds };
    },
    async edit(scope, payload) {
      const { chatId = scope.chatId, messageId, permits, uploads: local, file_sources, ...body } = payload;
      access.assertWrite(scope, chatId);
      const old = db.getMessage(scope.botId, chatId, messageId);
      if (!old) return fail('message_not_found', 'Saved message is unavailable. Edit requires a known original type.');
      if (!Object.keys(body).length && permits !== undefined) {
        assertCurrent(scope); access.assertWrite(scope, chatId); assertTarget(scope, chatId);
        try { savePermits(scope, chatId, messageId, permits); }
        catch { return fail('storage_failed', 'Saving permits failed. Retry the local permits update.'); }
        return { messageId, updated: ['permits'] };
      }
      const original = type(old), updated = [], failed = [], unknown = [];
      const suppliedType = body.media?.type ?? Object.keys(kinds).find(k => body[k] !== undefined);
      if (suppliedType && suppliedType !== original) return fail('invalid_argument', 'Edit must preserve the original message type.');
      if (body.media && ['caption', 'caption_entities', 'parse_mode'].some(key => body[key] !== undefined)) return fail('invalid_argument', 'When media is supplied, put caption and its formatting inside media.');
      const fileError = validateFiles(scope, body, file_sources, local); if (fileError) return fileError;
      const files = await uploads(scope, local, file_sources);
      const components = [];
      if (body.text !== undefined || body.rich_message !== undefined) components.push([original, 'editMessageText', { [original]: body[original], ...(body.entities ? { entities: body.entities } : {}), ...(body.parse_mode ? { parse_mode: body.parse_mode } : {}) }]);
      const changingMedia = suppliedType && !['text', 'rich_message'].includes(suppliedType);
      const captionFormat = { ...(body.caption_entities !== undefined ? { caption_entities: body.caption_entities } : {}), ...(body.parse_mode ? { parse_mode: body.parse_mode } : {}) };
      if (body.caption !== undefined && !changingMedia) components.push(['caption', 'editMessageCaption', { caption: body.caption, ...captionFormat }]);
      if (changingMedia) {
        const media = { ...(body.media ?? { type: suppliedType, media: body[suppliedType], ...(body.caption !== undefined ? { caption: body.caption, ...captionFormat } : {}) }) };
        if (media.caption === undefined) {
          if (old.caption !== undefined) media.caption = old.caption;
          if (media.caption_entities === undefined && media.parse_mode === undefined && old.caption_entities !== undefined) media.caption_entities = old.caption_entities;
        }
        components.push([suppliedType, 'editMessageMedia', { media }]);
      }
      if (body.reply_markup !== undefined) components.push(['reply_markup', 'editMessageReplyMarkup', { reply_markup: body.reply_markup }]);
      if (!components.length) return fail('invalid_argument', 'Specify at least one editable component.');
      for (const [part, method, fields] of components) {
        let result;
        try { result = await call(scope, method, { chat_id: chatId, message_id: messageId, ...fields }, files); }
        catch (e) { (e.code === 'telegram_transport_failed' ? unknown : failed).push(part); continue; }
        updated.push(part);
        try { if (typeof result === 'object') db.saveMessage(scope.botId, result); else db.saveMessage(scope.botId, { ...old, ...fields }); if (['rich_message', 'reply_markup'].includes(part)) savePermits(scope, chatId, messageId, permits); }
        catch { return fail('storage_failed', 'Telegram edit succeeded, but saving the result failed. Do not repeat confirmed components.', { messageId, updated }); }
      }
      return { messageId, updated, ...(failed.length ? { failed } : {}), ...(unknown.length ? { unknown } : {}), ...(failed.length || unknown.length ? fail('edit_failed', 'Some components were not confirmed. Retry only known failed components; check unknown results first.') : {}) };
    },
    async transfer(scope, name, args) {
      const { chatId = scope.chatId, fromChatId = scope.chatId, messageIds, permits, ...body } = args;
      access.assertRead(scope, fromChatId); access.assertWrite(scope, chatId);
      if (!messageIds?.length || messageIds.some((id, i) => !Number.isSafeInteger(id) || i && id <= messageIds[i - 1])) return fail('invalid_argument', 'messageIds must be in strictly increasing order.');
      const single = messageIds.length === 1;
      if (name === 'forward' && (body.reply_markup || body.reply_parameters || permits !== undefined || body.caption !== undefined || body.remove_caption !== undefined) || !single && (body.reply_markup || body.reply_parameters || permits !== undefined || body.caption !== undefined || body.caption_entities !== undefined || body.parse_mode !== undefined || body.show_caption_above_media !== undefined) || single && body.remove_caption !== undefined) return fail('invalid_argument', 'These forwarding or batch-copy fields are unsupported.');
      if (body.reply_parameters?.chat_id) access.assertRead(scope, body.reply_parameters.chat_id);
      try {
        const method = name === 'forward' ? single ? 'forwardMessage' : 'forwardMessages' : single ? 'copyMessage' : 'copyMessages';
        delete body.message_id; delete body.message_ids;
        const result = await call(scope, method, { ...body, chat_id: chatId, from_chat_id: fromChatId, ...(single ? { message_id: messageIds[0] } : { message_ids: messageIds }) });
        const values = Array.isArray(result) ? result : [result];
        if (name === 'forward' && single) { try { db.saveMessage(scope.botId, result); } catch { return fail('storage_failed', 'Forward succeeded but storage failed. Do not repeat.', { messageIds: [result.message_id] }); } }
        if (name === 'copy' && single) {
          const source = db.getMessage?.(scope.botId, fromChatId, messageIds[0]);
          if (source) {
            try {
              const chat = JSON.parse(db.getChat(scope.botId, chatId).json), bot = db.getBot(scope.botId);
              const message = { message_id: result.message_id, chat, date: Math.floor(Date.now() / 1000), reconstructed: true };
              for (const field of [...Object.keys(kinds).filter(k => k !== 'media'), 'entities', 'caption', 'caption_entities', 'show_caption_above_media', 'has_media_spoiler', 'live_photo']) if (source[field] !== undefined) message[field] = structuredClone(source[field]);
              if (chat.type === 'channel') message.sender_chat = chat;
              else message.from = { id: bot.telegramId, is_bot: true, first_name: bot.username, username: bot.username };
              if (body.caption !== undefined) { message.caption = body.caption; delete message.caption_entities; if (body.caption_entities) message.caption_entities = body.caption_entities; if (body.parse_mode) message.reconstructionNotes = 'Caption formatting was supplied as parse_mode and is not reconstructed from Telegram.'; }
              if (body.show_caption_above_media !== undefined) message.show_caption_above_media = body.show_caption_above_media;
              if (body.reply_markup !== undefined) message.reply_markup = body.reply_markup;
              if (body.protect_content) message.has_protected_content = true;
              if (body.reply_parameters) { const reply = db.getMessage(scope.botId, body.reply_parameters.chat_id ?? chatId, body.reply_parameters.message_id); if (reply) message.reply_to_message = reply; }
              db.saveMessage(scope.botId, message); savePermits(scope, chatId, result.message_id, permits);
            } catch { return fail('storage_failed', 'Copy succeeded but local reconstruction or permits storage failed. Do not repeat.', { messageIds: [result.message_id] }); }
          }
        }
        return { messageIds: values.map(m => m.message_id) };
      } catch (e) { return apiError(e); }
    },
  };
}
