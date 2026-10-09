import { parseTarget, pagination } from "./contract.mjs";
import { range } from "./administrative.mjs";
import { formatAgents } from "./agents-format.mjs";
import { syntaxError } from "./arguments.mjs";
export async function handleAgent({
  admin,
  group,
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
  const action = parts.shift() ?? "status";
  if (["status", "start", "stop", "clear"].includes(action)) {
    const t = parseTarget(parts, { star: ["stop", "clear"].includes(action) }),
      v = target(t);
    if (action === "status") {
      const { chat, a } = v;
      await send(
        `Агент: ${a?.agentId ?? "не создан"}\nРежим: ${chat.agentEnabled ? "включён" : "выключен"}` +
          (a
            ? `\nСтатус: ${agentStatus(a.agentId).status}\nОчередь: ${agentStatus(a.agentId).queue ?? 0}/10${admin ? "\nМодель: " + a.model : ""}`
            : "") +
          (group ? "\nИстория: сохраняется" : ""),
      );
      return true;
    }
    if (action === "start" && !["current", "chat"].includes(t.kind))
      throw syntaxError("Use start [in CHAT_ID].");
    if (action === "clear") {
      await send(
        await clearContext(
          botId,
          v.chat?.chatId ?? m.chat.id,
          t.kind === "all" ? "*" : v.a?.agentId,
        ),
      );
      return true;
    }
    const records = t.kind === "all" ? v.map((a) => a.chatId) : [v.chat.chatId],
      results = [];
    for (const id of records)
      try {
        results.push(await setAgentState(botId, id, action === "start"));
      } catch (e) {
        results.push(`${id}: ${e.message}`);
      }
    await send(results.join("\n") || "Записей нет");
    return true;
  }
  requireAdmin();
  if (action === "list") {
    if (parts.length > 1) throw syntaxError("Invalid range.");
    const records = db.sql
        .prepare(
          "SELECT agents.*,chats.name,chats.chatType,chats.json,chats.agentEnabled FROM agents JOIN chats USING(botId,chatId) WHERE botId=? ORDER BY createdAt,agentId",
        )
        .all(botId),
      [a, b] = range(parts[0]);
    await send(formatAgents(records.slice(a, b), a, records.length));
    return true;
  }
  if (action === "messages") {
    const r = pagination(parts);
    let direction;
    if (["from", "to"].includes(parts[0])) direction = parts.shift();
    if (direction && !parts.length) throw syntaxError("Specify filter target.");
    if (parts.length && parts.length !== 2)
      throw syntaxError("Specify agent AGENT_ID or chat CHAT_ID.");
    let kind = parts.shift() ?? "chat",
      id = parts.shift() ?? String(m.chat.id);
    if (parts.length || !["agent", "chat"].includes(kind))
      throw syntaxError("Invalid filter.");
    let a;
    if (kind === "chat") {
      if (!db.getChat(botId, Number(id))) throw syntaxError("Chat not found.");
      a = db.agent(botId, Number(id));
    } else {
      a = db.sql
        .prepare("SELECT * FROM agents WHERE botId=? AND agentId=?")
        .get(botId, id);
      if (!a) throw syntaxError("Agent not found.");
    }
    const records = a
      ? db.sql
          .prepare(
            "SELECT * FROM agent_messages WHERE botId=? ORDER BY date DESC,id DESC",
          )
          .all(botId)
          .filter((x) =>
            direction === "from"
              ? x.fromAgentId === a.agentId
              : direction === "to"
                ? x.toAgentId === a.agentId
                : x.fromAgentId === a.agentId || x.toAgentId === a.agentId,
          )
      : [];
    let output = page(
      records,
      r,
      (x) =>
        `${x.fromAgentId} → ${x.toAgentId} ${new Date(x.date).toISOString()}\n${x.text}`,
    );
    await send(
      output.length > 4000 ? output.slice(0, 3950) + "\n[обрезано]" : output,
    );
    return true;
  }
  if (action === "models") {
    if (parts.length) throw syntaxError("No arguments allowed.");
    await send((await deps.models()).map((x) => x.model).join("\n"));
    return true;
  }
  if (action === "model") {
    const set = parts[0] === "set";
    if (set) parts.shift();
    const model = set ? parts.pop() : undefined;
    let records,
      def = parts.length === 1 && parts[0] === "default";
    if (def) records = [];
    else {
      const v = target(parseTarget(parts, { star: set }));
      records = Array.isArray(v) ? v : [v.a];
      if (records.some((x) => !x)) throw syntaxError("Agent not found.");
    }
    if (set) {
      if (!(await deps.models()).some((x) => x.model === model))
        throw syntaxError("Model not available.");
      if (def)
        db.sql
          .prepare("UPDATE bots SET defaultModel=? WHERE botId=?")
          .run(model, botId);
      else
        db.transaction(() => {
          for (const a of records)
            db.sql
              .prepare("UPDATE agents SET model=? WHERE agentId=?")
              .run(model, a.agentId);
        });
      await send("Модель сохранена для следующего хода");
    } else
      await send(
        def
          ? db.getBot(botId).defaultModel
          : records.map((a) => a.model).join("\n"),
      );
    return true;
  }
  throw syntaxError("Unknown agent action.");
}
