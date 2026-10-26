import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";

test("React widget store keeps per-instance revisions and typed views", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "react-store-db-"));
  try {
    const db = openDatabase(path.join(dir, "db.sqlite"));
    try {
      db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
      db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
      db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
      const store = createWidgetStore(db);
      const fresh=store.create({botId:"b",agentId:"a",handler:"new.tsx",buildId:"new",description:"New"});
      assert.equal(store.save(fresh,{state:{count:0},storeVersion:1,revision:0}).storeVersion,1);
      const widget = store.create({ botId: "b", agentId: "a", handler: "game.tsx", description: "Game", runtimeProps: { length: 5 }, state: { score: 0 }, storeVersion: 2 });
      assert.equal(widget.storeVersion, 2);
      assert.equal(widget.storeRevision, 0);
      assert.deepEqual(widget.runtimeProps, { length: 5 });
      const ref = { widgetId: widget.widgetId, botId: "b", agentId: "a", generation: widget.generation };
      assert.equal(store.save(ref, { state: { score: 1 } }).storeRevision, 1);
      assert.equal(store.save(ref, { state: { score: 1 } }).storeRevision, 1);
      assert.equal(store.save(ref, { state: { score: 1 }, revision: 2 }).storeRevision, 2);
      const ordinary = store.createView(ref, { target: { chatId: -10, messageId: 21 }, exportName: "Players", props: { length: 5 } });
      assert.equal(ordinary.targetKind, "message");
      assert.equal(ordinary.exportName, "Players");
      assert.deepEqual(ordinary.props, { length: 5 });
      const privateView = store.createView(ref, { target: { chatId: -10, receiverUserId: 5, ephemeralMessageId: 22 }, parentViewId: ordinary.id });
      assert.equal(privateView.targetKind, "ephemeral");
      assert.equal(privateView.props, null);
      assert.equal(store.listViews(widget.widgetId).length, 2);
      store.recovery();
      assert.equal(store.listViews(widget.widgetId).length, 1);
      assert.equal(store.get(widget.widgetId).storeRevision, 2);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
