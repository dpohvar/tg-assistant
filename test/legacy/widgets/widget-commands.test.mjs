import test from "node:test";
import assert from "node:assert/strict";
import { handleWidgetCommand } from "../../src/commands/widget.mjs";
const items = [
  {
    widgetId: "w1",
    agentId: "a",
    botId: "b",
    chatId: -2,
    messageId: 7,
    status: "active",
    description: "Gallery",
    pending: 2,
    dropped: 0,
    createdAt: 1,
  },
  {
    widgetId: "w2",
    agentId: "other",
    botId: "b",
    chatId: 1,
    messageId: 8,
    status: "disabled",
    description: "Counter",
    pending: 3,
    dropped: 1,
    createdAt: 2,
  },
];
function fixture() {
  const output = [],
    removed = [];
  const db = {
    agent: (_b, id) =>
      id === 1
        ? { agentId: "a", botId: "b", chatId: 1 }
        : id === 2
          ? { agentId: "other", botId: "b", chatId: 2 }
          : null,
    sql: {
      prepare: () => ({
        get: (_b, id) =>
          ["a", "other"].includes(id) ? { agentId: id, botId: "b" } : null,
      }),
    },
  };
  const manager = {
    store: {
      list: () => items,
      get: (id) => items.find((x) => x.widgetId === id),
    },
    delete: async (_w, { widgetId }) => removed.push(widgetId),
  };
  return {
    db,
    manager,
    botId: "b",
    message: { chat: { id: 1 } },
    send: async (x) => output.push(x),
    output,
    removed,
  };
}
test("widget list filters owner before pagination and does not filter publication chat", async () => {
  const f = fixture();
  await handleWidgetCommand({ ...f, parts: ["list", "1", "in", "1"] });
  assert.match(f.output[0].text, /1-1 \/ 1/);
  assert.match(f.output[0].text, /w1/);
  assert.doesNotMatch(f.output[0].text, /w2/);
  assert.equal(f.output[0].entities[0].type, "code");
});
test("bulk widget deletion uses current owner and forbids all-delete syntax", async () => {
  const f = fixture();
  await handleWidgetCommand({ ...f, parts: ["delete", "*"] });
  assert.deepEqual(f.removed, ["w1"]);
  await assert.rejects(
    () => handleWidgetCommand({ ...f, parts: ["delete", "*", "all"] }),
    /Invalid/,
  );
});
test("show excludes raw state and callback secrets", async () => {
  const f = fixture();
  items[0].state = { token: "hidden" };
  await handleWidgetCommand({ ...f, parts: ["show", "w1"] });
  assert.doesNotMatch(f.output[0].text, /hidden|token/);
});
