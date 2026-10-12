import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
import { createWidgetManager } from "../../src/widgets/manager.mjs";
function fixture(t, options = {}) {
  const db = openDatabase(":memory:");
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: 1, type: "private", first_name: "Owner" });
  const a = db.ensureAgent("b", 1),
    scope = { botId: "b", agentId: a.agentId, chatId: 1 },
    store = createWidgetStore(db),
    calls = [];
  let nextMessageId = 7;
  const host = {
    canReserve: () => true,
    has: () => true,
    reserve: async () => {},
    load: async () => ({ hooks: ["render", "vote"] }),
    request: async (_r, m) =>
      m === "render"
        ? { text: "Fixture" }
        : m === "reserveEvent"
          ? true
          : undefined,
    release: async () => {},
    close: async () => {},
  };
  const render = {
    publish: async (ref, value) => {
      calls.push(value);
      const w = store.current(ref),
        message = {
          message_id: w.messageId ?? nextMessageId++,
          chat: { id: 1, type: "private" },
          text: value.text,
        };
      store.patch(ref, {
        messageId: message.message_id,
        message,
        lifecycleIntent: null,
      });
      return message;
    },
    disable: async () => {},
    forget() {},
  };
  const manager = createWidgetManager({
    db,
    host,
    store,
    build: async () => ({ snapshotId: "s" }),
    render,
    authorize: () => scope,
    notify: async () => {},
    ...options,
  });
  t.after(async () => {
    await manager.close();
    db.close();
  });
  return { manager, store, scope, render, calls, host, db };
}
test("create, active replacement and disabled resume preserve message identity", async (t) => {
  const f = fixture(t),
    created = await f.manager.set(f.scope, {
      handler: "a.tsx",
      description: "First",
      state: { keep: 1 },
    });
  const before = f.store.get(created.widgetId);
  await f.manager.set(f.scope, {
    widgetId: created.widgetId,
    handler: "b.tsx",
    description: "Second",
  });
  const replaced = f.store.get(created.widgetId);
  assert.equal(replaced.messageId, 7);
  assert.equal(replaced.generation, before.generation + 1);
  assert.deepEqual(replaced.state, { keep: 1 });
  f.store.disableOwner(replaced, "fixture");
  f.store.admit(replaced, {
    name: "onReply",
    source: "reply",
    receivedAt: new Date().toISOString(),
    delayed: false,
    data: {},
  });
  await f.manager.set(f.scope, { widgetId: created.widgetId });
  assert.equal(f.store.get(created.widgetId).status, "active");
  assert.equal(f.store.head(f.store.get(created.widgetId)).event.delayed, true);
});

test("an unhandled render error revokes effects and releases a disabled-only runtime", async (t) => {
  const f = fixture(t);
  const c = await f.manager.set(f.scope, {
    handler: "a.tsx",
    description: "First",
  });
  const w = f.store.get(c.widgetId);
  let released = 0;
  f.host.release = async () => {
    released++;
  };
  await f.manager.error(w, { code: "render_failed", message: "Bad render" });
  assert.equal(
    f.store.get(w.widgetId).disabledReason,
    "render_failed: Bad render",
  );
  assert.equal(f.manager.isRevoked(w), true);
  assert.equal(released, 1);
});

test("close drains a pending replacement and prevents late publication", async (t) => {
  const f = fixture(t);
  let finish, entered;
  const gate = new Promise((r) => {
    entered = r;
  });
  f.host.reserve = async () => {
    entered();
    await new Promise((r) => {
      finish = r;
    });
  };
  const setting = f.manager.set(f.scope, {
    handler: "a.tsx",
    description: "Pending",
  });
  const rejected = assert.rejects(setting, /widget_stopped/);
  await gate;
  let done = false;
  const closing = f.manager.close().then(() => {
    done = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false);
  finish();
  await rejected;
  await closing;
  assert.equal(f.calls.length, 0);
});
test("foreign ownership rejects state, event and deletion", async (t) => {
  const f = fixture(t),
    c = await f.manager.set(f.scope, {
      handler: "a.tsx",
      description: "First",
    }),
    other = { ...f.scope, agentId: "foreign" };
  assert.throws(
    () => f.manager.state(other, { widgetId: c.widgetId }),
    /widget_not_found/,
  );
  await assert.rejects(
    () => f.manager.delete(other, { widgetId: c.widgetId }),
    /widget_not_found/,
  );
});
test("uncertain send retains disabled provisional registration without retry", async (t) => {
  const f = fixture(t);
  f.render.publish = async () => {
    throw Object.assign(new Error("unknown"), { code: "delivery_unknown" });
  };
  await assert.rejects(
    () => f.manager.set(f.scope, { handler: "a.tsx", description: "Unknown" }),
    (e) => e.code === "delivery_unknown" && !!e.widgetId,
  );
  const w = f.store.list(f.scope)[0];
  assert.equal(w.status, "disabled");
  assert.equal(w.messageId, null);
  await assert.rejects(
    () => f.manager.set(f.scope, { widgetId: w.widgetId }),
    /delivery_unknown/,
  );
});
test("disabled debug is admitted separately without draining paused replies", async (t) => {
  const f = fixture(t),
    c = await f.manager.set(f.scope, {
      handler: "a.tsx",
      description: "First",
    }),
    w = f.store.get(c.widgetId);
  f.store.disableOwner(w, "fixture");
  f.store.admit(w, {
    name: "onReply",
    source: "reply",
    receivedAt: new Date().toISOString(),
    delayed: false,
    data: {},
  });
  await f.manager.render(f.scope, {
    widgetId: c.widgetId,
    state: { value: 2 },
  });
  await f.manager.idle();
  assert.equal(f.store.get(c.widgetId).status, "disabled");
  assert.equal(f.store.get(c.widgetId).pending, 1);
  assert.deepEqual(f.store.get(c.widgetId).state, { value: 2 });
});

test("shared recovery failure never initializes a stale sibling", async (t) => {
  const f = fixture(t);
  const first = await f.manager.set(f.scope, {
    handler: "a.tsx",
    description: "First",
  });
  await f.manager.set(f.scope, { handler: "b.tsx", description: "Second" });
  const loaded = [];
  f.host.load = async (w) => {
    loaded.push(w.widgetId);
    throw new Error("init failed");
  };
  await f.manager.recover();
  assert.deepEqual(loaded, [first.widgetId]);
  assert.equal(
    f.store.list(f.scope).every((w) => w.status === "disabled"),
    true,
  );
});
test("recovery restores a confirmed provisional send without replaying it or rolling back observations", async (t) => {
  let receipt;
  const f = fixture(t, { readReceipt: () => receipt });
  const w = f.store.create({
    ...f.scope,
    handler: "a.tsx",
    description: "Pending",
    snapshotId: "s",
    status: "disabled",
    lifecycleIntent: "creating",
  });
  receipt = {
    messageId: 71,
    message: { message_id: 71, chat: { id: 1 }, text: "confirmed" },
    lifecycleIntent: null,
  };
  await f.manager.recover();
  assert.equal(f.store.get(w.widgetId).messageId, 71);
  assert.equal(f.calls.length, 0);
  f.store.patch(w, {
    message: { ...receipt.message, reactions: { total: 3 } },
  });
  await f.manager.recover();
  assert.equal(f.store.get(w.widgetId).message.reactions.total, 3);
});
test("multiple disabled debug jobs render their supplied state in order", async (t) => {
  const f = fixture(t);
  const c = await f.manager.set(f.scope, {
    handler: "a.tsx",
    description: "First",
  });
  const w = f.store.get(c.widgetId);
  f.store.disableOwner(w, "fixture");
  const states = [];
  f.host.request = async (_r, m, args) => {
    if (m === "render") {
      states.push(args.state);
      return { text: "debug" };
    }
  };
  await Promise.all([
    f.manager.render(f.scope, { widgetId: w.widgetId, state: { n: 1 } }),
    f.manager.render(f.scope, { widgetId: w.widgetId, state: { n: 2 } }),
  ]);
  await f.manager.idle();
  assert.deepEqual(states, [{ n: 1 }, { n: 2 }]);
  assert.equal(f.store.get(w.widgetId).pending, 0);
});
test("retiring the caller during a child build prevents child publication", async (t) => {
  let hold = false,
    started,
    finish;
  const gate = new Promise((r) => {
    started = r;
  });
  const f = fixture(t, {
    build: async () => {
      if (hold) {
        started();
        await new Promise((r) => {
          finish = r;
        });
      }
      return { snapshotId: "s" };
    },
    authorize: (ref) => {
      if (ref.widgetId && f.manager.isRevoked(ref))
        throw Object.assign(new Error("widget_stopped"), {
          code: "widget_stopped",
        });
      return f.scope;
    },
  });
  const source = await f.manager.set(f.scope, {
    handler: "a.tsx",
    description: "Source",
  });
  const callerRef = f.store.get(source.widgetId);
  hold = true;
  const setting = f.manager.set(
    f.scope,
    { handler: "b.tsx", description: "Child" },
    { callerRef },
  );
  const rejected = assert.rejects(setting, /widget_stopped/);
  await gate;
  await f.manager.delete(f.scope, { widgetId: source.widgetId });
  finish();
  await rejected;
  assert.equal(f.calls.length, 2); // only source's initial render and onCreate render
  assert.equal(f.store.list(f.scope).length, 0);
});
test("repeated projection storage failure preserves IDs and tears down its runtime", async (t) => {
  const f = fixture(t);
  let released = 0;
  f.host.release = async () => {
    released++;
  };
  f.render.publish = async () => {
    f.store.patch = () => {
      throw new Error("storage still unavailable");
    };
    throw Object.assign(new Error("confirmed send, failed DB"), {
      code: "storage_failed",
      messageId: 71,
      nativeMessage: { message_id: 71, chat: { id: 1 }, text: "sent" },
    });
  };
  await assert.rejects(
    () => f.manager.set(f.scope, { handler: "a.tsx", description: "Failure" }),
    (e) =>
      e.code === "storage_failed" &&
      e.confirmedMessageId === 71 &&
      typeof e.widgetId === "string",
  );
  assert.equal(released, 1);
});
test("a failed projection never kills a healthy sibling runtime", async (t) => {
  const f = fixture(t);
  await f.manager.set(f.scope, { handler: "a.tsx", description: "Healthy" });
  let released = 0;
  f.host.release = async () => {
    released++;
  };
  f.render.publish = async () => {
    f.store.patch = () => {
      throw new Error("DB unavailable");
    };
    throw Object.assign(new Error("storage failure"), {
      code: "storage_failed",
      messageId: 72,
      nativeMessage: { message_id: 72, chat: { id: 1 } },
    });
  };
  await assert.rejects(
    () => f.manager.set(f.scope, { handler: "b.tsx", description: "Failed" }),
    { code: "storage_failed" },
  );
  assert.equal(released, 0);
});
test("retiring the caller during onCreate prevents the next render", async (t) => {
  const f = fixture(t, {
    authorize: (ref) => {
      if (ref.widgetId && f.manager.isRevoked(ref))
        throw Object.assign(new Error("widget_stopped"), {
          code: "widget_stopped",
        });
      return f.scope;
    },
  });
  const source = await f.manager.set(f.scope, {
    handler: "a.tsx",
    description: "Source",
  });
  const callerRef = f.store.get(source.widgetId);
  let started, finish;
  const gate = new Promise((r) => {
    started = r;
  });
  f.host.request = async (_r, m, args) => {
    if (m === "render") return { text: "Child" };
    if (m === "hook" && args.name === "onCreate") {
      started();
      await new Promise((r) => {
        finish = r;
      });
    }
  };
  const setting = f.manager.set(
    f.scope,
    { handler: "b.tsx", description: "Child" },
    { callerRef },
  );
  const rejected = assert.rejects(setting, /widget_stopped/);
  await gate;
  await f.manager.delete(f.scope, { widgetId: source.widgetId });
  finish();
  await rejected;
  assert.equal(f.calls.length, 3);
  assert.equal(f.store.list(f.scope)[0].status, "disabled");
});
