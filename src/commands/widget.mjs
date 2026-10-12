import { syntaxError } from "./arguments.mjs";
import { pagination } from "./contract.mjs";
import { range } from "./administrative.mjs";
import { formatWidgets, formatWidget } from "./widgets-format.mjs";
export async function handleWidgetCommand({
  botId,
  message,
  parts,
  db,
  manager,
  send,
}) {
  if (!manager) throw syntaxError("Widget storage is not configured.");
  const action = parts.shift() ?? "list";
  function owner(filter, { all = false } = {}) {
    if (!filter.length)
      return db.agent(botId, message.chat.id)?.agentId ?? null;
    if (all && filter.length === 1 && filter[0] === "all") return "*";
    if (filter.length === 2 && filter[0] === "agent") {
      if (
        !db.sql
          .prepare("SELECT * FROM agents WHERE botId=? AND agentId=?")
          .get(botId, filter[1])
      )
        throw syntaxError("Agent not found.");
      return filter[1];
    }
    if (
      filter.length === 2 &&
      filter[0] === "in" &&
      /^-?\d+$/.test(filter[1]) &&
      Number.isSafeInteger(+filter[1])
    ) {
      const a = db.agent(botId, +filter[1]);
      if (!a) throw syntaxError("Agent not found.");
      return a.agentId;
    }
    throw syntaxError("Invalid widget selector.");
  }
  if (action === "list") {
    const page = pagination(parts),
      id = owner(parts, { all: true }),
      all = manager.store.list({ botId }),
      filtered = id === "*" ? all : all.filter((w) => w.agentId === id),
      [start, end] = range(page);
    await send(
      formatWidgets(
        await Promise.all(
          filtered
            .slice(start, end)
            .map((w) => (manager.describe ? manager.describe(w) : w)),
        ),
        start,
        end,
        filtered.length,
      ),
    );
    return;
  }
  if (action === "show" && parts.length === 1) {
    const w = manager.store.get(parts[0]);
    if (!w || w.botId !== botId) throw syntaxError("Widget not found.");
    await send(formatWidget(manager.describe ? await manager.describe(w) : w));
    return;
  }
  if (action === "delete" && parts.length) {
    const widgetId = parts.shift();
    let targets;
    if (widgetId === "*") {
      const id = owner(parts);
      targets = manager.store.list({ botId }).filter((w) => w.agentId === id);
    } else {
      if (parts.length) throw syntaxError("Invalid widget deletion.");
      const w = manager.store.get(widgetId);
      if (!w || w.botId !== botId) throw syntaxError("Widget not found.");
      targets = [w];
    }
    let deleted = 0,
      failed = 0;
    for (const w of targets)
      try {
        await manager.delete(
          w,
          { widgetId: w.widgetId },
          { administrative: true },
        );
        deleted++;
      } catch {
        failed++;
      }
    await send(`Deleted: ${deleted}${failed ? `; failed: ${failed}` : ""}`);
    return;
  }
  throw syntaxError("Invalid widget command.");
}
