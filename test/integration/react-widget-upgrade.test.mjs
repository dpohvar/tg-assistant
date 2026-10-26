import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/storage/database.mjs";
import { runLegacyCleanup } from "../../src/widgets/legacy-cleanup.mjs";

function legacyDatabase(file) {
  const sql = new DatabaseSync(file);
  sql.exec("PRAGMA foreign_keys=ON");
  for (let version = 1; version <= 20; version++)
    sql.exec(fs.readFileSync(new URL(`../../src/storage/migrations/${String(version).padStart(3, "0")}.sql`, import.meta.url), "utf8"));
  sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'test_bot',5)").run();
  sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','Group','{}')").run();
  sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
  sql.prepare("INSERT INTO widgets(widgetId,botId,agentId,status,handler,snapshotId,description,state,createdAt) VALUES('w','b','a','active','game.tsx','snapshot','Game','{}',1)").run();
  sql.prepare("INSERT INTO widget_views(viewId,widgetId,botId,agentId,chatId,messageId,bindingEpoch,message) VALUES('v1','w','b','a',-10,123,'e1','{}')").run();
  sql.prepare("INSERT INTO widget_views(viewId,widgetId,botId,agentId,inlineMessageId,bindingEpoch,message) VALUES('v2','w','b','a','opaque','e2','{}')").run();
  sql.prepare("INSERT INTO widget_events(widgetId,seq,payload,bytes,started) VALUES('w',1,'{}',2,0),('w',2,'{}',2,1)").run();
  sql.prepare("INSERT INTO widget_publication_candidates(viewId,widgetId,botId,agentId,chatId,createdAt,reason) VALUES('unknown','w','b','a',-10,1,'delivery_unknown')").run();
  sql.close();
}

test("upgrade retires legacy registrations and queues, preserving confirmed cleanup targets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "react-widget-upgrade-"));
  try {
    const file = path.join(dir, "db.sqlite");
    const source = path.join(dir, "game.tsx");
    fs.writeFileSync(source, "export function Game() {}\n");
    legacyDatabase(file);
    const db = openDatabase(file);
    try {
      assert.equal(db.sql.prepare("SELECT MAX(version) AS n FROM schema_migrations").get().n, 21);
      assert.equal(db.sql.prepare("SELECT count(*) n FROM widgets").get().n, 0);
      assert.equal(db.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='widget_events'").get().n, 0);
      assert.equal(db.sql.prepare("SELECT count(*) n FROM widget_views").get().n, 0);
      assert.equal(db.sql.prepare("SELECT count(*) n FROM agents").get().n, 1);
      const targets = db.sql.prepare("SELECT target FROM widget_legacy_cleanup ORDER BY target").all().map(row => JSON.parse(row.target));
      assert.deepEqual(targets, [{ chatId: -10, messageId: 123 }, { inlineMessageId: "opaque" }]);
      assert.equal(fs.readFileSync(source, "utf8"), "export function Game() {}\n");
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("legacy cleanup retries only unfinished confirmed jobs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "react-widget-cleanup-"));
  try {
    const file = path.join(dir, "db.sqlite");
    legacyDatabase(file);
    const db = openDatabase(file);
    try {
      const calls = [];
      let failInline = true;
      const telegram = { async editMessageReplyMarkup(botId, args) {
        calls.push({ botId, args });
        if (args.inline_message_id && failInline) throw new Error("temporary network failure");
      } };
      const authorize = async ({ botId, agentId }) => botId === "b" && agentId === "a";
      assert.deepEqual(await runLegacyCleanup({ db, telegram, authorize }), { done: 1, failed: 1 });
      failInline = false;
      assert.deepEqual(await runLegacyCleanup({ db, telegram, authorize }), { done: 1, failed: 0 });
      assert.equal(calls.length, 3);
      assert.equal(db.sql.prepare("SELECT count(*) n FROM widget_legacy_cleanup WHERE status='done'").get().n, 2);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
