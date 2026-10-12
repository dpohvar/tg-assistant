export function formatWidgets(items, start, end, total) {
  const entities = [];
  let text = `${items.length ? start + 1 : 0}-${items.length ? start + items.length : 0} / ${total}`;
  const add = (s, type) => {
    const offset = text.length;
    text += String(s);
    if (type) entities.push({ type, offset, length: String(s).length });
  };
  for (const w of items) {
    add("\n\n");
    add(w.widgetId, "code");
    add(" ");
    add(w.status, "italic");
    add("\n" + w.description + "\nOwner: ");
    add(w.agentId, "code");
    add("\nMessage: ");
    add(`${w.chatId}/${w.messageId ?? "unknown"}`, "code");
    add(`\nPending: ${w.pending}`);
  }
  return { text, entities };
}
export function formatWidget(w) {
  const result = formatWidgets([w], 0, 1, 1);
  result.text += `\nHandler: ${w.handler ?? "unknown"}\nTopic: ${w.topicId ?? "none"}\nDisabled reason: ${w.disabledReason ?? "none"}\nDropped: ${w.dropped}\nCreated: ${new Date(w.createdAt).toISOString()}`;
  return result;
}
