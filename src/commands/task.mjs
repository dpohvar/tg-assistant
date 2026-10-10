import { parseTarget, pagination } from "./contract.mjs";
import { range } from "./administrative.mjs";
import { formatTasks } from "./tasks-format.mjs";
import { syntaxError } from "./arguments.mjs";
export async function handleTask({
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
  const action = parts.shift() ?? "list";
  if (action === "list") {
    const r = pagination(parts);
    if (parts.length && !["agent", "in"].includes(parts[0]))
      throw syntaxError("Use agent AGENT_ID or in CHAT_ID.");
    if (parts[0] === "agent" && parts.length !== 2)
      throw syntaxError("Specify AGENT_ID.");
    let t;
    if (parts[0] === "agent") {
      parts.shift();
      t = parseTarget(parts);
    } else t = parseTarget(parts);
    const { a } = target(t);
    const tasks = a
        ? scheduler
            .list(a)
            .tasks.map((x) => taskDetails(scheduler.task(x.taskId)))
        : [],
      [lo, hi] = range(r);
    await send(formatTasks(tasks.slice(lo, hi), lo, tasks.length));
    return true;
  }
  if (!["show", "retry", "delete"].includes(action))
    throw syntaxError("Unknown task action.");
  const id = parts.shift();
  if (!id) throw syntaxError("Specify TASK_ID or *.");
  let tasks;
  if (id === "*") {
    if (action === "show") throw syntaxError("Use task list.");
    if (parts.length && parts[0] !== "in")
      throw syntaxError("Use * [in CHAT_ID].");
    const { a } = target(parseTarget(parts));
    tasks = a
      ? scheduler.list(a).tasks.map((x) => scheduler.task(x.taskId))
      : [];
  } else {
    if (parts.length) throw syntaxError("Unexpected arguments.");
    const task = scheduler.task(id);
    const a =
      task &&
      db.sql
        .prepare("SELECT * FROM agents WHERE botId=? AND agentId=?")
        .get(botId, task.agentId);
    if (!a) throw syntaxError("Task not found.");
    if (a.chatId === m.chat.id) requireLocal();
    else requireAdmin();
    tasks = [task];
  }
  if (action === "show") {
    await send(formatTasks(tasks.map(taskDetails), 0, 1));
    return true;
  }
  if (action === "retry" && tasks.some((t) => !scheduler.enabled(t.agentId)))
    throw syntaxError("Agent is disabled. Run /agent start first");
  let ok = 0,
    skipped = 0,
    errors = [];
  for (const t of tasks) {
    try {
      if (action === "retry") scheduler.retry(t.taskId);
      else scheduler.cancel({ agentId: t.agentId }, [t.taskId]);
      ok++;
    } catch (e) {
      skipped++;
      errors.push(e.message);
    }
  }
  await send(
    `Succeeded: ${ok}; skipped: ${skipped}` +
      (errors.length ? "\n" + [...new Set(errors)].join("\n") : ""),
  );
  return true;
}
