/** Deterministic native transport fixture. The React runtime is attached in Task 5. */
export function createReactWidgetFixture() {
  let nextMessageId = 1;
  const calls = [];
  const messages = new Map();
  const transport = {
    calls,
    messages,
    async send(target, body) {
      const message = { chatId: target.chatId, messageId: nextMessageId++, body };
      calls.push({ method: "send", target, body, message });
      messages.set(`${message.chatId}:${message.messageId}`, message);
      return message;
    },
    async edit(target, body) {
      calls.push({ method: "edit", target, body });
      const key = `${target.chatId}:${target.messageId}`;
      if (!messages.has(key)) throw new Error("message_not_found");
      const message = { ...messages.get(key), body };
      messages.set(key, message);
      return message;
    },
  };
  return { transport, calls, messages };
}
