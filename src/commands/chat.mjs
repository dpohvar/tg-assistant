import { syntaxError } from "./arguments.mjs";
export async function handleChat({
  stopAgent,
  telegram,
  parts,
  db,
  botId,
  send,
  requireAdmin,
  requireLocal,
  target,
  clearContext,
  m,
  setAgentState,
  agentStatus,
  deps,
  page,
  scheduler,
  taskDetails,
}) {
  const action = parts.shift() ?? "info";
  if (action === "list") {
    requireAdmin();
    if (parts.length > 1) throw syntaxError("Invalid range.");
    await send(
      page(
        db.sql
          .prepare(
            "SELECT chats.*,agents.agentId FROM chats LEFT JOIN agents USING(botId,chatId) WHERE botId=? ORDER BY chatId",
          )
          .all(botId),
        parts[0],
        (c) =>
          `${c.chatType} ${c.name} ${c.chatType === "private" && c.chatId !== m.chat.id ? (c.agentId ?? "личный диалог") : c.chatId} — ${c.agentEnabled ? "агент включён" : "агент выключен"}`,
      ),
    );
    return true;
  }
  if (!["info", "leave"].includes(action) || parts.length > 1)
    throw syntaxError("Invalid chat action.");
  if (parts.length) requireAdmin();
  else requireLocal();
  const id = parts.length ? Number(parts[0]) : m.chat.id,
    c = db.getChat(botId, id);
  if (!c) throw syntaxError("Chat not found.");
  if (action === "leave") {
    if (c.chatType === "private")
      throw syntaxError("Use /agent stop for a private chat.");
    await send("Выхожу из чата; данные диалога удаляются. Wiki сохранится.");
    await stopAgent(botId, id);
    return true;
  }
  let detail = {};
  if (c.chatType !== "private")
    try {
      detail = await telegram.call(botId, "getChat", { chat_id: id });
      detail.botMember = await telegram.call(botId, "getChatMember", {
        chat_id: id,
        user_id: db.getBot(botId).telegramId,
      });
    } catch {}
  await send(
    `${c.name} (${c.chatType})\n${c.chatType === "private" && id !== m.chat.id ? "" : "chatId: " + id + "\n"}${detail.username ? "@" + detail.username + "\n" : ""}Подключён\nАгент: ${db.agent(botId, id)?.agentId ?? "нет"}\nРежим: ${c.agentEnabled ? "включён" : "выключен"}${detail.botMember ? "\nПрава: " + JSON.stringify(detail.botMember) : ""}`,
  );
  return true;
}
