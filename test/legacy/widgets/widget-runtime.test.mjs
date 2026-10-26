import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../../src/widgets/runtime.mjs";
import { createLocalQueue } from "../../src/widgets/queue.mjs";
const ref = { botId: "b", agentId: "a", widgetId: "w", generation: 1 };

test("retirement during an asynchronous render fences save and publish", async () => {
  let finish, started;
  const gate = new Promise((r) => {
    started = r;
  });
  const effects = [];
  const runtime = createRuntime({ bridge: async (m) => effects.push(m) });
  await runtime.load(ref, {
    state: {},
    message: { message_id: 7 },
    module: {
      render: () => {
        started();
        return new Promise((r) => {
          finish = r;
        });
      },
      go: (ctx) => {
        ctx.state.n = 1;
      },
    },
  });
  const action = runtime.dispatch(ref, { name: "go", source: "agent" });
  await gate;
  let stopped=false;const retirement=runtime.retire(ref).then(()=>stopped=true);
  await new Promise(r=>setImmediate(r));assert.equal(stopped,false);
  finish({ text: "late" });
  await action;await retirement;
  assert.deepEqual(effects, []);
});
test("onInit cannot render before publication but can render an existing attachment", async () => {
  const runtime = createRuntime({ bridge: async () => {} });
  const module = {
    render: () => ({ text: "x" }),
    onInit: (ctx) => ctx.render(),
  };
  await runtime.load(ref, { state: {}, module });
  await assert.rejects(
    () => runtime.hook(ref, "onInit"),
    /message_not_created/,
  );
  await runtime.retire(ref);
  await runtime.load(ref, { state: {}, message: { message_id: 7 }, module });
  await runtime.hook(ref, "onInit");
  await runtime.close();
});
test("unhandled render failure is distinguished from a recoverable action error", async () => {
  const errors = [];
  const r = createRuntime({
    bridge: async (m, a) => {
      if (m === "notifyError") errors.push(a.error);
    },
  });
  await r.load(ref, {
    state: {},
    message: { message_id: 7 },
    module: {
      render() {
        throw new Error("bad render");
      },
      go(ctx) {
        ctx.state.changed = true;
      },
    },
  });
  await r.dispatch(ref, { name: "go", source: "agent" });
  assert.equal(errors[0].code, "render_failed");
  await r.close();
});
test("callback exports must exist and routing fields cannot be supplied by render", async () => {
  const r = createRuntime({ bridge: async () => {} });
  await r.load(ref, {
    module: {
      render: () => ({
        text: "x",
        reply_markup: {
          inline_keyboard: [[{ text: "x", callback_data: "missing" }]],
        },
      }),
    },
  });
  await assert.rejects(() => r.render(ref), /No exported action/);
  await r.close();
});
test("local queue preserves arbitrary references and bounds pending excluding running", () => {
  const q = createLocalQueue({ capacity: 1 }),
    data = { fn: () => 42 };
  assert.equal(q.enqueue("tick", data), true);
  assert.equal(q.enqueue("tick", {}), false);
  data.changed = true;
  assert.equal(q.take().data, data);
  assert.equal(q.enqueue("tick", {}), true);
});
test("intermediate commit survives later action failure and recovery handler starts with saved state", async () => {
  let saved = {},
    edits = 0,
    notice = 0;
  const r = createRuntime({
    bridge: async (m, a) => {
      if (m === "save") saved = structuredClone(a.state);
      if (m === "publish") {
        edits++;
        return { message_id: 7, text: "1" };
      }
      if (m === "notifyError") notice++;
    },
  });
  await r.load(ref, {
    state: { step: 0 },
    message: { message_id: 7 },
    module: {
      render: (s) => ({ text: String(s.step) }),
      async fail(ctx) {
        ctx.state.step = 1;
        await ctx.render();
        ctx.state.step = 2;
        throw new Error("fail");
      },
      onError(ctx) {
        assert.equal(ctx.state.step, 1);
        return true;
      },
    },
  });
  await r.dispatch(ref, { name: "fail", source: "agent", data: null });
  assert.deepEqual(saved, { step: 1 });
  assert.equal(edits, 1);
  assert.equal(notice, 0);
  await r.retire(ref);
});
test("retired context rejects enqueue/render and disposes all managed resources in reverse order", async () => {
  const order = [];
  let ctx;
  const r = createRuntime({ bridge: async () => {} });
  await r.load(ref, {
    state: {},
    module: {
      render: () => ({ text: "ok" }),
      onInit(c) {
        ctx = c;
        c.defer(() => order.push(1));
        c.defer(() => {
          order.push(2);
          throw new Error("cleanup");
        });
        c.defer(() => order.push(3));
        c.setInterval(() => assert.fail("timer leaked"), 1000);
      },
    },
  });
  await r.hook(ref, "onInit");
  await r.retire(ref);
  assert.deepEqual(order, [3, 2, 1]);
  assert.throws(() => ctx.enqueue("tick"), /widget_stopped/);
  await assert.rejects(() => ctx.render(), /widget_stopped/);
});
test("two widgets continue independently during asynchronous handler work", async () => {
  let finish,
    ran = false;
  const r = createRuntime({ bridge: async () => {} }),
    other = { ...ref, widgetId: "w2" };
  await r.load(ref, {
    state: {},
    module: {
      render: () => ({ text: "ok" }),
      wait: () => new Promise((resolve) => (finish = resolve)),
    },
  });
  await r.load(other, {
    state: {},
    module: {
      render: () => ({ text: "ok" }),
      go: () => {
        ran = true;
      },
    },
  });
  const waiting = r.dispatch(ref, { name: "wait", source: "local" });
  await new Promise((r) => setImmediate(r));
  await r.dispatch(other, { name: "go", source: "local" });
  assert.equal(ran, true);
  finish();
  await waiting;
  await r.close();
});
