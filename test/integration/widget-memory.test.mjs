import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../../src/storage/database.mjs";
import { BotFiles } from "../../src/files/paths.mjs";
import { WIDGET_LIMITS } from "../../src/widgets/contract.mjs";
import { createWidgetHost } from "../../src/widgets/host.mjs";
import { createReactWidgetManager } from "../../src/widgets/manager-react.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
import { writeWidgetMemoryDump } from "../../src/widgets/memory-dump.mjs";

const owner = { botId: "b", agentId: "a" };
function database(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.registerBot({ botId: "b", telegramId: 1, username: "bot", ownerId: 5 });
  db.saveChat("b", { id: 1, type: "private" });
  db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',1,'test',1)").run();
  return db;
}

test("widget memory is measured for the owner's whole process tree and uses 512 MiB limit", async t => {
  assert.equal(WIDGET_LIMITS.memory, 512 * 1024 * 1024);
  let bytes = 42 * 1024 * 1024;
  const failures = [];
  const host = createWidgetHost({
    launch: async () => {
      const child = new EventEmitter();
      child.ready = Promise.resolve();
      child.close = async () => {};
      return child;
    },
    measureTree: async () => ({ bytes, processes: [{ pid: 1, bytes }] }),
    terminateTree: async () => {},
    onFailure: async (_owner, error) => failures.push(error),
  });
  t.after(() => host.close());
  assert.equal(await host.memoryUsage(owner), 0);
  await host.reserve(owner);
  assert.equal(await host.memoryUsage(owner), bytes);
  bytes = 300 * 1024 * 1024;
  await host.sample();
  assert.equal(failures.length, 0);
  bytes = WIDGET_LIMITS.memory + 1;
  await host.sample();
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /536870913.*536870912/);
  assert.deepEqual(failures[0].memorySample, {
    bytes: 536870913,
    limitBytes: 536870912,
    processes: [{ pid: 1, bytes: 536870913 }],
  });
  assert.equal(await host.memoryUsage(owner), 0);
});

test("widget list reports runtime memory instead of a registration-count quota", async t => {
  const db = database(t);
  const store = createWidgetStore(db);
  const host = { memoryUsage: async () => 12345, canReserve: () => true };
  const manager = createReactWidgetManager({ db, store, host, build: async () => {},
    authorize: () => {}, snapshotPath: () => "" });
  const result = await manager.list(owner);
  assert.deepEqual(result.memory, { usedBytes: 12345, limitBytes: 512 * 1024 * 1024 });
  assert.equal("quota" in result, false);
  assert.equal("canCreate" in result, false);
});

test("registrations have no per-agent count cap", t => {
  const db = database(t);
  const store = createWidgetStore(db);
  for (let i = 0; i < 11; i++)
    store.create({ ...owner, handler: "test.tsx", description: `Widget ${i}`, state: {} });
  assert.equal(store.list(owner).length, 11);
});

test("runtime failure keeps measured memory details in widget status", async t => {
  const db = database(t);
  const store = createWidgetStore(db);
  const widget = store.create({ ...owner, handler: "test.tsx", description: "Test", state: {} });
  const notices = [];
  const manager = createReactWidgetManager({ db, store, host: {}, build: async () => {},
    authorize: () => {}, snapshotPath: () => "",
    notify: async (_owner, event) => notices.push(event) });
  const error = Object.assign(new Error("536870913 bytes used, 536870912 bytes allowed"),
    { code: "widget_stopped" });
  await manager.failure(owner, error);
  assert.deepEqual(store.get(widget.widgetId).lastError,
    { code: "widget_stopped", message: error.message });
  assert.match(notices[0].description, /536870913.*536870912/);
});

test("memory dump replaces one agent temp file without copying widget state", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-memory-dump-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = database(t), store = createWidgetStore(db), files = new BotFiles(root, owner.agentId);
  const widget = store.create({ ...owner, handler: "wordle.tsx", description: "Test",
    state: { secret: "answer-must-not-appear" } });
  const input = { owner, store, filesFor: () => files, clock: () => Date.UTC(2026, 9, 28),
    sample: { bytes: 600, limitBytes: 512, processes: [
      { pid: 7, ppid: 1, start: "abc", bytes: 600, commandLine: "secret-command" }] } };
  const expectedPath = `.temp/${owner.agentId}/widget-memory-dump.json`;
  assert.equal(writeWidgetMemoryDump(input), expectedPath);
  const first = files.read(expectedPath).toString("utf8");
  const dump = JSON.parse(first);
  assert.deepEqual(dump.memory, { usedBytes: 600, limitBytes: 512, processCount: 1 });
  assert.deepEqual(dump.processes, [{ pid: 7, ppid: 1, start: "abc", rssBytes: 600 }]);
  assert.deepEqual(dump.widgets, [{ widgetId: widget.widgetId, handler: "wordle.tsx",
    status: "active", viewCount: 0 }]);
  assert.equal(dump.capturedAt, "2026-10-28T00:00:00.000Z");
  assert.doesNotMatch(first, /answer-must-not-appear|secret-command/);
  assert.equal(writeWidgetMemoryDump({ ...input, sample: { ...input.sample, bytes: 700 } }), expectedPath);
  assert.equal(JSON.parse(files.read(expectedPath)).memory.usedBytes, 700);
  assert.deepEqual(fs.readdirSync(path.join(root, ".temp", owner.agentId)),
    ["widget-memory-dump.json"]);
});

test("runtime failure records the dump path and still stops widgets when writing fails", async t => {
  const { reportWidgetMemoryFailure } = await import("../../src/widgets/memory-dump.mjs");
  assert.equal(typeof reportWidgetMemoryFailure, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-memory-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = database(t), store = createWidgetStore(db), files = new BotFiles(root, owner.agentId);
  store.create({ ...owner, handler: "test.tsx", description: "Test", state: {} });
  const seen = [];
  const manager = { failure: async (_owner, error) => seen.push(error) };
  const sample = { bytes: 600, limitBytes: 512, processes: [] };
  const error = Object.assign(new Error("memory limit"), { memorySample: sample });
  await reportWidgetMemoryFailure({ owner, error, store, filesFor: () => files, manager });
  assert.equal(error.diagnosticPath, `.temp/${owner.agentId}/widget-memory-dump.json`);
  assert.equal(seen[0], error);
  const failed = Object.assign(new Error("memory limit"), { memorySample: sample });
  await reportWidgetMemoryFailure({ owner, error: failed, store,
    filesFor: () => ({ write: () => { throw new Error("disk full"); } }), manager });
  assert.equal(failed.diagnosticUnavailable, true);
  assert.equal(seen[1], failed);
});

test("updating a widget closes its old ephemeral views before forgetting them", async t => {
  const db = database(t);
  const store = createWidgetStore(db);
  const widget = store.create({ ...owner, handler: "test.tsx", buildId: "old", description: "Test", state: {} });
  const publicView = store.createView(widget, { target: { chatId: 1, messageId: 10 }, exportName: "Main" });
  const ephemeral = store.createView(widget, { target: { chatId: 1, receiverUserId: 2, ephemeralMessageId: 11 }, parentViewId: publicView.id });
  const calls = [];
  const host = { has: () => true, request: async (_ref, method) => { calls.push(method); },
    reserve: async () => {}, load: async () => {}, memoryUsage: async () => 0 };
  const manager = createReactWidgetManager({ db, store, host,
    build: async () => ({ snapshotId: "new" }), authorize: () => {}, snapshotPath: () => "",
    disableView: async (_ref, view) => calls.push(`disable:${view.id}`),
    invalidateView: viewId => calls.push(`invalidate:${viewId}`),
    invalidateParent: viewId => calls.push(`parent:${viewId}`),
  });
  await manager.update(owner, { widgetId: widget.widgetId, handler: "test.tsx" });
  assert.ok(calls.includes(`disable:${ephemeral.id}`));
  assert.ok(calls.indexOf(`disable:${ephemeral.id}`) < calls.indexOf("mount"));
  assert.ok(calls.includes(`invalidate:${ephemeral.id}`));
  assert.ok(calls.includes(`parent:${publicView.id}`));
  assert.equal(store.getView(ephemeral.id), null);
  assert.ok(store.getView(publicView.id));
});
