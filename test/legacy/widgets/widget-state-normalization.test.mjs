import test from "node:test";
import assert from "node:assert/strict";
import { plainJSON, validateWidgetState } from "../../src/widgets/contract.mjs";
import { createRuntime } from "../../src/widgets/runtime.mjs";
import { createContext } from "../../src/widgets/context.mjs";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";

const ref = { botId: "b", agentId: "a", widgetId: "w", generation: 1 };

test("state omits undefined object fields and preserves array positions, including holes", () => {
  const state = { ownerId: undefined, config: { value: undefined, keep: false }, values: [undefined, , 1] };
  assert.equal(validateWidgetState(state), '{"config":{"keep":false},"values":[null,null,1]}');
  assert.ok(Object.hasOwn(state, "ownerId"), "validation must not mutate its input");
  assert.equal(Object.hasOwn(state.values, 1), false);
  assert.throws(() => plainJSON(state), /invalid_argument/, "non-state JSON remains strict");
});

test("root and other unsupported values remain invalid; serialization must not call getters or toJSON", () => {
  let invoked = false;
  const accessor = { get value() { invoked = true; return undefined; } };
  const extraArray = [1]; extraArray.extra = undefined;
  for (const state of [undefined, null, [], { value: NaN }, { value: Infinity }, { value: 1n },
    { value: () => 1 }, { value: Symbol() }, { value: new Map() }, { value: new Date() },
    { toJSON() { invoked = true; return {}; } }, accessor, { values: extraArray }])
    assert.throws(() => validateWidgetState(state), /invalid_argument/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => validateWidgetState(cycle), /invalid_argument/);
  assert.equal(invoked, false);
});

test("sparse state arrays never execute inherited getters or serialization hooks", () => {
  let invoked = false;
  const values = new Array(1);
  Object.setPrototypeOf(values, { get 0() { invoked = true; return NaN; } });
  assert.throws(() => validateWidgetState({ values }), /invalid_argument/);
  assert.equal(invoked, false);
  const old = Object.getOwnPropertyDescriptor(Array.prototype, "123");
  const context = createContext({ ref, state: {}, queueInfo: () => ({}), enqueue() {}, commit() {}, api() {} });
  context.ctx.state = { values: new Array(124) };
  let json;
  try {
    Object.defineProperty(Array.prototype, "123", { configurable: true,
      get() { invoked = true; return "unexpected"; } });
    json = validateWidgetState({ values: new Array(124) });
    context.normalize();
  } finally {
    if (old) Object.defineProperty(Array.prototype, "123", old);
    else delete Array.prototype[123];
  }
  assert.equal(invoked, false);
  assert.deepEqual(JSON.parse(json), { values: Array(124).fill(null) });
  assert.deepEqual(context.ctx.state, { values: Array(124).fill(null) });
});

test("runtime load and every render receive the same normalized initial state", async (t) => {
  let ctx;
  const views = [];
  const runtime = createRuntime({ bridge: async () => {} });
  t.after(() => runtime.close());
  await runtime.load(ref, { state: { hidden: undefined, values: [undefined] }, module: {
    onInit(c) { ctx = c; },
    render(s) { views.push(structuredClone(s)); return { text: "Fixture" }; },
  } });
  await runtime.hook(ref, "onInit");
  assert.deepEqual(ctx.state, { values: [null] });
  await runtime.render(ref);
  await runtime.render(ref, { state: { replaced: undefined, nested: { keep: 1, hidden: undefined } } });
  assert.deepEqual(views, [{ values: [null] }, { nested: { keep: 1 } }]);
  assert.deepEqual(ctx.state, { nested: { keep: 1 } });
});

test("Wordle-style initialization succeeds with omitted, empty and complete starting state", async (t) => {
  for (const state of [undefined, {}, { mode: "menu", players: {}, activeId: null }]) {
    const saved = [], views = [];
    let ctx;
    const runtime = createRuntime({ bridge: async (method, args) => {
      if (method === "save") saved.push(structuredClone(args.state));
    } });
    t.after(() => runtime.close());
    await runtime.load(ref, { ...(state === undefined ? {} : { state }), module: {
      onInit(c) {
        ctx = c;
        const s = c.state;
        s.mode ??= "menu";
        if (!s.players) { s.players = {}; s.ownerId ??= s.player?.id; }
        s.activeId ??= null;
      },
      render(s) { views.push(s); return { text: s.mode }; },
    } });
    await runtime.hook(ref, "onInit");
    await runtime.render(ref);
    assert.deepEqual(ctx.state, { mode: "menu", players: {}, activeId: null });
    assert.deepEqual(views[0], ctx.state);
    for (const s of saved) assert.deepEqual(s, ctx.state);
  }
});

test("successful automatic and intermediate commits keep normalized state, render and saved snapshots aligned", async (t) => {
  const saves = [], views = [];
  let ctx;
  const runtime = createRuntime({ bridge: async (method, args) => {
    if (method === "save") saves.push(structuredClone(args.state));
    if (method === "publish") return { message_id: 7, text: args.value.text };
    if (method === "notifyError") assert.fail(args.error.message);
  } });
  t.after(() => runtime.close());
  await runtime.load(ref, { state: { step: 0, nested: {} }, message: { message_id: 7 }, module: {
    render(s) { views.push(structuredClone(s)); return { text: String(s.step) }; },
    async go(c) {
      ctx = c;
      const s = c.state, nested = s.nested;
      s.step = 1; s.omit = undefined; nested.hidden = undefined; s.values = [undefined];
      await c.render();
      assert.equal(s, c.state, "a mutable state reference must survive an intermediate commit");
      assert.equal(nested, c.state.nested);
      assert.equal(Object.hasOwn(s, "omit"), false);
      assert.deepEqual(s.values, [null]);
      s.step = 2; nested.keep = true; nested.hidden = undefined;
    },
  } });
  await runtime.dispatch(ref, { source: "agent", name: "go", data: {} });
  assert.deepEqual(saves, [
    { step: 1, nested: {}, values: [null] },
    { step: 2, nested: { keep: true }, values: [null] },
  ]);
  assert.deepEqual(views, saves);
  assert.deepEqual(ctx.state, saves[1]);
});

test("normalization-only changes clean memory without an unnecessary save or render", async (t) => {
  let ctx;
  const effects = [];
  const runtime = createRuntime({ bridge: async (method) => effects.push(method) });
  t.after(() => runtime.close());
  await runtime.load(ref, { state: {}, message: { message_id: 7 }, module: {
    render: () => ({ text: "Fixture" }),
    go(c) { ctx = c; c.state.absent = undefined; },
  } });
  await runtime.dispatch(ref, { source: "agent", name: "go", data: {} });
  assert.deepEqual(ctx.state, {});
  assert.deepEqual(effects, []);
});

test("last normalized commit survives later failure and is restored before onError", async (t) => {
  let seen;
  const runtime = createRuntime({ bridge: async (method) => method === "publish" ? { message_id: 7 } : undefined });
  t.after(() => runtime.close());
  await runtime.load(ref, { state: { step: 0 }, message: { message_id: 7 }, module: {
    render: () => ({ text: "Fixture" }),
    async fail(c) { c.state.step = 1; c.state.omit = undefined; await c.render(); c.state.step = 2; throw new Error("Fixture failure"); },
    onError(c) { seen = structuredClone(c.state); return true; },
  } });
  await runtime.dispatch(ref, { source: "agent", name: "fail", data: {} });
  assert.deepEqual(seen, { step: 1 });
});

test("frozen optional fields can normalize and root state remains valid", () => {
  const context = createContext({ ref, state: {}, message: null, queueInfo: () => ({}), enqueue() {}, commit() {}, api() {} });
  context.ctx.state = Object.freeze({ hidden: undefined, config: Object.freeze({ value: undefined, keep: true }) });
  assert.equal(context.changed(), true);
  assert.deepEqual(context.ctx.state, { config: { keep: true } });
});

test("normalized JSON survives database reads and runtime restoration without a migration", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: 1, type: "private" });
  const a = db.ensureAgent("b", 1), store = createWidgetStore(db);
  const w = store.create({ botId: "b", agentId: a.agentId, chatId: 1, handler: "w.ts", snapshotId: "s", description: "Fixture",
    state: { omitted: undefined, values: [undefined] }, message: null });
  assert.deepEqual(store.get(w.widgetId).state, { values: [null] });
  store.save(w, { state: { step: 1, omitted: undefined, values: [undefined] } });
  const runtime = createRuntime({ bridge: async () => {} });
  t.after(() => runtime.close());
  let restored;
  await runtime.load(w, { state: store.get(w.widgetId).state, module: {
    onInit(c) { restored = c.state; }, render: () => ({ text: "Fixture" }),
  } });
  await runtime.hook(w, "onInit");
  assert.deepEqual(restored, { step: 1, values: [null] });
});
