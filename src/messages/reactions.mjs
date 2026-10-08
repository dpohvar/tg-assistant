export function recordReaction(db, botId, event, own) {
  const message = db.getMessage(botId, event.chat.id, event.message_id);
  if (!message) return;
  const state = message.reactions ?? {};
  const date = new Date(event.date * 1000).toISOString();
  // Late anonymous snapshots must not overwrite a newer observation.
  if (state.updatedAt && date < state.updatedAt) return;
  if (own !== undefined) state.own = own;
  else if (event.reactions) { state.counts = event.reactions; state.countsComplete = true; }
  else {
    const identity = event.user ? { userId: event.user.id } : event.actor_chat ? { actorChatId: event.actor_chat.id } : null;
    if (!identity) return;
    const key = Object.keys(identity)[0], id = identity[key];
    state.users = [...(state.users ?? []).filter(user => user[key] !== id), { ...identity, reactions: event.new_reaction }];
    const counts = new Map((state.counts ?? []).map(item => [JSON.stringify(item.type), { ...item }]));
    for (const [list, delta] of [[event.old_reaction ?? [], -1], [event.new_reaction ?? [], 1]]) for (const type of list) {
      const key = JSON.stringify(type), item = counts.get(key);
      if (item) item.total_count = Math.max(0, item.total_count + delta);
      else if (delta > 0) counts.set(key, { type, total_count: 1 });
    }
    state.counts = [...counts.values()]; state.countsComplete = false;
  }
  state.updatedAt = date;
  message.reactions = state;
  db.sql.prepare('UPDATE messages SET json=? WHERE botId=? AND chatId=? AND messageId=?').run(JSON.stringify(message), botId, event.chat.id, event.message_id);
}
