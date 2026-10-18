import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
function setup(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: 1, type: "private", first_name: "Owner" });
  const agent = db.ensureAgent("b", 1),
    store = createWidgetStore(db);
  const create = () =>
    store.create({
      botId: "b",
      agentId: agent.agentId,
      chatId: 1,
      messageId: null,
      handler: "w.tsx",
      snapshotId: "s",
      description: "Fixture",
      state: { step: 1 },
      message: null,
    });
  return { db, store, create };
}
test("old generation cannot overwrite replacement state", (t) => {
  const { db, store, create } = setup(t),
    old = create();
  db.sql
    .prepare("UPDATE widgets SET generation=generation+1 WHERE widgetId=?")
    .run(old.widgetId);
  assert.throws(
    () => store.save(old, { state: { stale: true } }),
    /widget_stopped/,
  );
  assert.deepEqual(store.get(old.widgetId).state, { step: 1 });
});
test("durable FIFO starts only once and pending excludes running", (t) => {
  const { store, create } = setup(t),
    w = create(),
    event = {
      name: "vote",
      source: "agent",
      receivedAt: new Date(0).toISOString(),
      delayed: false,
      data: {},
    };
  const a = store.admit(w, event),
    b = store.admit(w, event);
  assert.equal(store.get(w.widgetId).pending, 2);
  assert.deepEqual(store.begin(w, a.seq), event);
  assert.equal(store.get(w.widgetId).pending, 1);
  assert.throws(() => store.begin(w, a.seq));
  store.complete(w, a.seq);
  assert.equal(store.head(w).seq, b.seq);
});
test("queue quota is transactional and stopping clears all backlog", (t) => {
  const { store, create } = setup(t),
    w = create(),
    e = {
      name: "reply",
      source: "reply",
      receivedAt: new Date(0).toISOString(),
      delayed: false,
      data: {},
    };
  for (let i = 0; i < 1000; i++) assert.equal(store.admit(w, e).accepted, true);
  assert.equal(store.admit(w, e).reason, "queue_full");
  assert.equal(store.get(w.widgetId).pending, 1000);
  assert.equal(store.get(w.widgetId).dropped, 1);
  store.disableOwner(w, "failure");
  assert.equal(store.get(w.widgetId).pending, 0);
  assert.throws(
    () => store.admit(w, { ...e, source: "agent" }),
    /widget_stopped/,
  );
});
test("registration quota includes stopped widgets and view projections survive history cleanup", (t) => {
  const { db, store, create } = setup(t);
  const first = create();
  store.disableOwner(first, "fixture");
  for (let i = 1; i < 10; i++) create();
  assert.throws(create, /widget_quota/);
  store.save(first, {state:{keep:true}});
  const view=store.createView(first,{target:{chatId:1,messageId:7},message:{message_id:7,chat:{id:1},text:'Keep'}});
  db.sql.exec("DELETE FROM messages");
  assert.equal(store.getView(view.id).message.text, "Keep");
  store.remove(first.widgetId);
  assert.doesNotThrow(create);
});
test("control state uses 1 MiB cap and shares queue byte admission", (t) => {
  const { store, create } = setup(t),
    w = create();
  const state = { x: "a".repeat(70000) },
    r = store.admitRender(w, state);
  assert.equal(r.accepted, true);
  assert.deepEqual(store.begin(w, r.seq).data.state, state);
});
