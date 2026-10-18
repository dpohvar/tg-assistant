import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createController } from "../../src/controller.mjs";
test("widget replies intercept before disabled chat-agent route and commands still win", async (t) => {
  const db = openDatabase(":memory:");
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: -1, type: "supergroup", title: "Fixture" });
  const a = db.ensureAgent("b", -1),
    w = {
      widgetId: "w",
      botId: "b",
      agentId: a.agentId,
      generation: 1,
      status: "active",
      view:{id:'v',target:{chatId:-1,messageId:7},props:{},bindingEpoch:'epoch',buttonNames:[],message:{message_id:7,chat:{id:-1}}},
      chatId: -1,
      messageId: 7,
      buttonNames: [],
      message: { message_id: 7, chat: { id: -1 } },
      state: {},
    };
  const captured = [],
    runs = [];
  const widgetService = {
    store: {
      byMessage: (_b, _c, id) => (id === 7 ? w : null),
      patch() {},
      get: () => w,
      list: () => [],
    },
    hasHook: () => true,
    admit: async (_w, e) => captured.push(e),
    recover: async () => {},
    close: async () => {},
    idle: async () => {},
    disableOwner: async () => {},
    removeOwner: async () => {},
    removeChat: async () => {},
  };
  const c = createController({
    db,
    widgetService,
    telegram: { call: async () => ({}) },
    agent: { run: async () => runs.push(1) },
  });
  t.after(async () => {
    c.close();
    await c.idle();
    db.close();
  });
  db.sql.exec("UPDATE chats SET agentEnabled=0");
  const message = {
    message_id: 8,
    date: 1,
    chat: { id: -1, type: "supergroup" },
    from: { id: 1 },
    text: "Reply",
    reply_to_message: { message_id: 7 },
  };
  await c.receive("b", { message });
  assert.equal(captured.length, 1);
  assert.equal(db.getMessage("b", -1, 8).text, "Reply");
  await c.receive("b", {
    message: { ...message, message_id: 9, text: "/help" },
  });
  assert.equal(captured.length, 1);
  assert.equal(runs.length, 0);
});
