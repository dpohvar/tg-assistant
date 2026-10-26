import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetAPI } from "../../src/widgets/api.mjs";
test("widget API derives owner scope and refuses nonapproved capability", async () => {
  const ref = { botId: "b", agentId: "a", widgetId: "w", generation: 1 },
    calls = [];
  const api = createWidgetAPI({
    authorize: () => ({ botId: "b", agentId: "a", chatId: 1, widgetRef: ref }),
    invoke: async (scope, name, args) => {
      calls.push({ scope, name, args });
      return { status: "done" };
    },
    manager: {},
    notify: async () => {},
  });
  await api(ref, "send", { chatId: -1, text: "ok", botId: "foreign" });
  assert.equal(calls[0].scope.botId, "b");
  await assert.rejects(() => api(ref, "exec_command", {}), /access_denied/);
  await assert.rejects(() => api(ref, "ws_open", {}), /access_denied/);
  await assert.rejects(() => api(ref, "mcp", {}), /access_denied/);
});
test("revoked generation fails before API effects", async () => {
  const api = createWidgetAPI({
    authorize: () => {
      throw Object.assign(new Error("widget_stopped"), {
        code: "widget_stopped",
      });
    },
    invoke: async () => assert.fail(),
    manager: {},
  });
  await assert.rejects(
    () => api({ widgetId: "w" }, "send", { text: "no" }),
    /widget_stopped/,
  );
});
