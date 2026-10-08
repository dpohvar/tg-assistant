import { createHmac, timingSafeEqual } from 'node:crypto';
import { shortMessage } from '../telegram/short-message.mjs';
export function readableDates(value) {
  if (Array.isArray(value)) return value.map(readableDates);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['date', 'edit_date'].includes(key) && typeof item === 'number' ? new Date(item * 1000).toISOString() : readableDates(item)]));
}
export function createHistory({ db, access, key, now = Date.now }) {
  const error = (code, text) => Object.assign(new Error(text), { code });
  const signature = data => createHmac('sha256', key).update(data).digest();
  const encode = state => { const payload = Buffer.from(JSON.stringify(state)).toString('base64url'); return payload + '.' + signature(payload).toString('base64url'); };
  const decode = token => { const parts = token.split('.'); if (parts.length !== 2) throw error('invalid_cursor', 'Invalid search cursor.'); const sig = Buffer.from(parts[1], 'base64url'), expected = signature(parts[0]); if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) throw error('invalid_cursor', 'Invalid search cursor.'); const state = JSON.parse(Buffer.from(parts[0], 'base64url')); if (state.expires <= now()) throw error('cursor_expired', 'Search cursor expired; start a new search.'); return state; };
  const rows = (s, id) => { access.assertRead(s, id); return db.sql.prepare('SELECT * FROM messages WHERE botId=? AND chatId=? ORDER BY date,messageId').all(s.botId, id); };
  const short = row => shortMessage(JSON.parse(row.json));
  const discussionIds = (scope, chatId, discussion) => {
    if (!discussion) return null;
    access.assertRead(scope, discussion.chatId);
    const all = rows(scope, chatId), root = all.find(r => { const m = JSON.parse(r.json); return m.is_automatic_forward && m.forward_origin?.type === 'channel' && m.forward_origin.chat.id === discussion.chatId && m.forward_origin.message_id === discussion.messageId; });
    if (!root) throw error('discussion_not_found', 'Automatic forwarded discussion root is unavailable in saved history.');
    const ids = new Set([root.messageId]); let changed = true;
    while (changed) { changed = false; for (const r of all) if (!ids.has(r.messageId) && (ids.has(r.replyTo) || JSON.parse(r.json).message_thread_id === root.messageId)) { ids.add(r.messageId); changed = true; } }
    ids.delete(root.messageId); return ids;
  };
  return {
    read(s, { messageIds, chatId = s.chatId }) {
      access.assertRead(s, chatId);
      return { messages: messageIds.map(messageId => { const message = db.getMessage(s.botId, chatId, messageId); const state = message ? db.sql.prepare('SELECT permits FROM button_state WHERE botId=? AND chatId=? AND messageId=?').get(s.botId, chatId, messageId) : null; if (message && state?.permits != null) message.permits = JSON.parse(state.permits); return message ? readableDates(message) : { messageId, error: 'message_not_found', description: 'Message is unavailable as a separate saved record. If it was referenced by a reply, read the outer current messageId and inspect reply_to_message; Telegram may include the old content there.' }; }) };
    },
    history(s, { chatId = s.chatId, messageId = null, from, to, discussion }) {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) throw error('invalid_argument', 'from/to must define a valid integer interval.');
      const ids = discussionIds(s, chatId, discussion), list = rows(s, chatId).filter(r => !ids || ids.has(r.messageId)); const anchor = messageId === null ? list.length : list.findIndex(r => r.messageId === messageId);
      if (anchor < 0) throw error('message_not_found', 'History anchor is unavailable.');
      return { messages: list.slice(Math.max(0, anchor + from), Math.max(0, anchor + to)).map(short) };
    },
    search(s, args) {
      let state;
      if (args.cursor !== undefined) {
        if (Object.keys(args).length !== 1) throw error('invalid_argument', 'A cursor cannot be combined with filters.');
        state = decode(args.cursor); if (state.botId !== s.botId || state.agentId !== s.agentId) throw error('invalid_cursor', 'Search cursor belongs to another agent.');
      } else {
        const { limit = 20, chatId = s.chatId, ...filters } = args;
        if (!Number.isSafeInteger(limit) || limit < 1 || filters.text?.some(t => typeof t !== 'string' || !t.length)) throw error('invalid_argument', 'Invalid limit or text filter.');
        for (const date of [filters.since, filters.until].filter(Boolean)) if (!/(Z|[+-]\d\d:\d\d)$/.test(date) || !Number.isFinite(Date.parse(date))) throw error('invalid_argument', 'Date must be ISO 8601 with an explicit offset.');
        state = { botId: s.botId, agentId: s.agentId, chatId, limit, filters, expires: now() + 3600000, boundary: db.sql.prepare('SELECT value FROM message_sequence').get().value, position: null };
      }
      access.assertRead(s, state.chatId); const f = state.filters, ids = discussionIds(s, state.chatId, f.discussion);
      const list = db.sql.prepare('SELECT * FROM messages WHERE botId=? AND chatId=? AND receiptSeq<=? ORDER BY date DESC,messageId DESC').all(s.botId, state.chatId, state.boundary).filter(r => {
        if (ids && !ids.has(r.messageId)) return false;
        if (state.position && (r.date > state.position[0] || r.date === state.position[0] && r.messageId >= state.position[1])) return false;
        if (f.senderId !== undefined && r.senderId !== f.senderId || f.since && r.date * 1000 < Date.parse(f.since) || f.until && r.date * 1000 >= Date.parse(f.until)) return false;
        if (f.text && !f.text.every(t => r.plainText.toLocaleLowerCase().includes(t.toLocaleLowerCase()))) return false;
        if (f.types) { const m = JSON.parse(r.json); if (!f.types.some(type => type === 'text' ? m.text !== undefined || m.caption !== undefined : m[type] !== undefined)) return false; }
        return true;
      });
      const page = list.slice(0, state.limit), result = { messages: page.map(short) };
      if (list.length > state.limit) { const last = page.at(-1); result.nextCursor = encode({ ...state, position: [last.date, last.messageId] }); }
      return result;
    },
  };
}
