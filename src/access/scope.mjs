export const roles = { user: 1, manager: 2, admin: 3, owner: 4 };
export function createAccess(db) {
  const chat = (s, id) => { if (!Number.isSafeInteger(id)) throw Object.assign(new Error('chatId must be a safe integer.'), { code: 'invalid_argument' }); const c = db.getChat(s.botId, id); if (!c || c.chatType === 'private' && id !== s.chatId) throw Object.assign(new Error('Chat is not accessible to this agent.'), { code: 'chat_not_accessible' }); return c; };
  return {
    assertRead(s, id = s.chatId) { return chat(s, id); },
    assertWrite(s, id = s.chatId) { const c = chat(s, id); if (id !== s.chatId && (db.agent(s.botId, id) || !['supergroup', 'channel'].includes(c.chatType))) throw Object.assign(new Error('Use agent_message to ask the other chat agent to act.'), { code: 'chat_not_writable' }); return c; },
    requireRole(botId, userId, minimum) { if ((roles[db.role(botId, userId)] ?? 0) < roles[minimum]) throw Object.assign(new Error('The user does not have the required role.'), { code: 'access_denied' }); },
  };
}
