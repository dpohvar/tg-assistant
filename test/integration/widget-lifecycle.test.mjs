import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
import { createController } from "../../src/controller.mjs";
import { createWidgetService } from "../../src/widgets/service.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("controller revocation fences a disabled generation before runtime teardown", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-authority-")),
    db = openDatabase(":memory:");
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: 1, type: "private" });
  const a = db.ensureAgent("b", 1);
  const service = createWidgetService({
    db,
    config: { dataDir: root, botsDir: root },
    telegram: { call: async () => ({}) },
    filesFor: () => ({}),
    invoke: async () => ({}),
  });
  t.after(async () => {
    await service.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const w = service.store.create({
    botId: "b",
    agentId: a.agentId,
    chatId: 1,
    handler: "a.tsx",
    snapshotId: "s",
    description: "Fixture",
  });
  assert.doesNotThrow(() => service.authorize(w));
  await service.disableOwner(w);
  assert.throws(() => service.authorize(w), /widget_stopped/);
  const next = service.store.replace(w, {}, { keepPending: true });
  assert.doesNotThrow(() => service.authorize(next));
});

test("chat migration preserves widget publication, projection and backlog", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: -1, type: "group", title: "Old" });
  const a = db.ensureAgent("b", -1),
    store = createWidgetStore(db),
    w = store.create({
      botId: "b",
      agentId: a.agentId,
      chatId: -1,
      messageId: 7,
      handler: "w.tsx",
      snapshotId: "s",
      description: "Fixture",
      message: { message_id: 7, chat: { id: -1, type: "group" }, text: "Keep" },
    });
  const view=store.createView(w,{target:{chatId:-1,messageId:7},message:{message_id:7,chat:{id:-1,type:'group'},text:'Keep'}});
  store.admit(w, {
    name: "onReply",
    source: "reply",
    receivedAt: new Date().toISOString(),
    delayed: false,
    data: { message_id: 8, chat: { id: -1, type: "group" } },
  });
  db.migrateChat("b", -1, { id: -1001, type: "supergroup", title: "New" });
  const next = store.get(w.widgetId);
  assert.equal(store.getView(view.id).target.chatId, -1001);
  assert.equal(store.getView(view.id).message.chat.id, -1001);
  assert.equal(next.pending, 1);
  assert.equal(store.head(next).event.data.chat.id, -1001);
});
test("read falls back to durable widget projection without restoring ordinary history", async (t) => {
  const db = openDatabase(":memory:");
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: 1, type: "private", first_name: "Owner" });
  const a = db.ensureAgent("b", 1),
    store = createWidgetStore(db);
  const w=store.create({
    botId: "b",
    agentId: a.agentId,
    chatId: 1,
    messageId: 7,
    handler: "w.tsx",
    snapshotId: "s",
    description: "Fixture",
    message: {
      message_id: 7,
      date: 1,
      chat: { id: 1, type: "private" },
      text: "Long lived",
    },
  });
  store.createView(w,{target:{chatId:1,messageId:7},message:{message_id:7,date:1,chat:{id:1,type:'private'},text:'Long lived'}});
  const c = createController({
    db,
    widgetService: {
      store,
      recover: async () => {},
      close: async () => {},
      idle: async () => {},
      authorize: () => {},
    },
    telegram: { call: async () => ({}) },
    agent: { run: async () => {} },
  });
  t.after(async () => {
    c.close();
    await c.idle();
    db.close();
  });
  const result = await c.invoke(c.lifecycle.scope(a), "read", {
    messageIds: [7],
  });
  assert.equal(result.messages[0].text, "Long lived");
  assert.equal(db.getMessage("b", 1, 7), null);
});
