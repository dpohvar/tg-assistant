export const serviceFields = ["new_chat_members", "left_chat_member", "chat_owner_left", "chat_owner_changed", "new_chat_title", "new_chat_photo", "delete_chat_photo", "group_chat_created", "supergroup_chat_created", "channel_chat_created", "message_auto_delete_timer_changed", "migrate_to_chat_id", "migrate_from_chat_id", "pinned_message", "successful_payment", "refunded_payment", "users_shared", "chat_shared", "gift", "unique_gift", "gift_upgrade_sent", "connected_website", "write_access_allowed", "passport_data", "proximity_alert_triggered", "boost_added", "chat_background_set", "checklist_tasks_done", "checklist_tasks_added", "community_chat_added", "community_chat_joined", "community_chat_removed", "direct_message_price_changed", "forum_topic_created", "forum_topic_edited", "forum_topic_closed", "forum_topic_reopened", "general_forum_topic_hidden", "general_forum_topic_unhidden", "giveaway_created", "giveaway_completed", "managed_bot_created", "paid_message_price_changed", "poll_option_added", "poll_option_deleted", "suggested_post_approved", "suggested_post_approval_failed", "suggested_post_declined", "suggested_post_paid", "suggested_post_refunded", "video_chat_scheduled", "video_chat_started", "video_chat_ended", "video_chat_participants_invited", "web_app_data"];
export function richText(value) {
  const texts = [];
  const walk = item => { if (!item || typeof item !== 'object') return; if (typeof item.text === 'string') texts.push(item.text); for (const child of Object.values(item)) if (child && typeof child === 'object') walk(child); };
  walk(value); return texts.join('\n');
}
export function shortMessage(m, eventType = 'message') {
  const out = { eventType, messageId: m.message_id, date: new Date(m.date * 1000).toISOString() };
  const service = serviceFields.find(field => m[field] !== undefined); if (service) out.service = service;
  if (m.edit_date) out.editDate = new Date(m.edit_date * 1000).toISOString();
  const sender = m.sender_chat ?? m.from;
  if (sender) out.from = { [m.sender_chat ? 'chatId' : 'userId']: sender.id, name: sender.title ?? [sender.first_name, sender.last_name].filter(Boolean).join(' '), ...(sender.username ? { username: sender.username } : {}) };
  if (m.reply_to_message) out.replyTo = m.reply_to_message.message_id;
  if (m.author_signature) out.authorSignature = m.author_signature;
  if (m.media_group_id) out.albumId = m.media_group_id;
  const text = (key, value, entities) => { const chars = [...value]; out[key] = chars.slice(0, 1000).join(''); if (chars.length > 1000) out.truncated = true; if (entities?.length) out.hasEntities = true; };
  if (m.text !== undefined) text('textPlain', m.text, m.entities);
  if (m.caption !== undefined) text('captionPlain', m.caption, m.caption_entities);
  if (m.reply_markup?.inline_keyboard?.flat().length) out.inlineButtons = true;
  if (m.photo) { const p = m.photo.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b)); out.photo = `${p.width}x${p.height}`; }
  for (const kind of ['document', 'audio', 'animation']) if (m[kind]) out[kind] = m[kind].file_name ?? '';
  if (m.animation) { delete out.document; if (m.animation.duration !== undefined) out.duration = m.animation.duration; }
  if (m.audio) for (const field of ['duration', 'title', 'performer']) if (m.audio[field] !== undefined) out[field] = m.audio[field];
  for (const [native, key] of [['video', 'video'], ['video_note', 'videoNote'], ['voice', 'voice'], ['sticker', 'sticker']]) if (m[native]) { const value = m[native]; out[key] = key === 'video' ? `${value.width}x${value.height}` : key === 'sticker' ? value.emoji ?? '' : true; if (value.duration !== undefined) out.duration = value.duration; }
  if (m.location) { out.location = `${m.location.latitude},${m.location.longitude}`; if (m.location.live_period) out.live = true; }
  if (m.rich_message) {
    const attachments = {}; let richButtons = false;
    const walk = value => { if (!value || typeof value !== 'object') return; if (value.callback_data !== undefined || value.type === 'buttons') richButtons = true; if (value.type && ['photo', 'video', 'audio', 'document', 'animation'].includes(value.type) && value[value.type] !== undefined) attachments[value.type] = (attachments[value.type] ?? 0) + 1; for (const v of Object.values(value)) if (v && typeof v === 'object') walk(v); };
    walk(m.rich_message); text('richPlain', richText(m.rich_message)); if (richButtons) out.richButtons = true; if (Object.keys(attachments).length) out.richAttachments = attachments;
  }
  if (m.live_photo) { delete out.photo; const p = m.live_photo.photo?.at(-1) ?? m.photo?.at(-1); out.livePhoto = p ? `${p.width}x${p.height}` : ''; }
  if (m.venue) { out.venue = m.venue.title; out.address = m.venue.address; out.location = `${m.venue.location.latitude},${m.venue.location.longitude}`; }
  if (m.contact) out.contact = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ');
  if (m.poll) { out.poll = m.poll.question; out.options = m.poll.options.map(o => o.text); if (m.poll.type === 'quiz') out.quiz = true; }
  if (m.dice) { out.dice = m.dice.emoji; out.value = m.dice.value; }
  for (const [native, key] of [['story', 'story'], ['paid_media', 'paidMedia'], ['giveaway', 'giveaway'], ['giveaway_winners', 'giveawayWinners']]) if (m[native]) out[key] = true;
  for (const kind of ['checklist', 'game', 'invoice']) if (m[kind]) out[kind] = m[kind].title ?? '';
  return out;
}
