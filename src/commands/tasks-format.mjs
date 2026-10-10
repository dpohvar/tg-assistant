// Plain text + UTF-16 Telegram entities: no parsing or escaping of user instructions.
export function formatTasks(tasks, offset, total) {
  if (!tasks.length) return 'No records';
  let text = `${offset + 1}-${offset + tasks.length} / ${total}\n`;
  const entities = [];
  const append = (value, type) => { const offset = text.length; text += value; entities.push({ type, offset, length: value.length }); };
  tasks.forEach((task, index) => {
    if (index) text += '\n\n';
    append(task.taskId, 'code'); text += ' ';
    append(task.at ?? `${task.cron} (${task.timezone})`, 'italic');
    if(task.state)text+='\n'+task.state+(task.missed?' — skipped: '+task.missed:'');
    if (task.description) { text += '\n'; append(task.description, 'bold'); }
    if (task.text) { text += '\n'; append(task.text, 'pre'); }
  });
  if (text.length > 4000) {
    let end = 4000;
    if (/^[\uD800-\uDBFF]$/.test(text[end - 1])) end--;
    text = text.slice(0, end) + '\n[truncated]';
    for (const entity of entities) entity.length = Math.max(0, Math.min(entity.length, end - entity.offset));
  }
  return { text, entities: entities.filter(entity => entity.length > 0) };
}
