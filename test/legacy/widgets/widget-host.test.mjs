import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createWidgetHost } from "../../src/widgets/host.mjs";
function fixture(t) {
  let now = 0,
    bytes = 1,
    kills = 0;
  const failures = [];
  const h = createWidgetHost({
    clock: () => now,
    launch: async () => {
      const c = new EventEmitter();
      c.pid = 11;
      c.ready = Promise.resolve();
      c.request = async () => 42;
      c.close = async () => {};
      return c;
    },
    measureTree: async () => ({ bytes }),
    terminateTree: async () => {
      kills++;
    },
    onFailure: async (o, e) => failures.push(e),
  });
  t.after(() => h.close());
  return {
    h,
    failures,
    get kills() {
      return kills;
    },
    set now(v) {
      now = v;
    },
    set bytes(v) {
      bytes = v;
    },
  };
}
test("concurrent runtime reservations honor one owner and ten per bot", async (t) => {
  const { h } = fixture(t);
  await Promise.all([
    h.reserve({ botId: "b", agentId: "a" }),
    h.reserve({ botId: "b", agentId: "a" }),
  ]);
  for (let i = 1; i < 10; i++)
    await h.reserve({ botId: "b", agentId: "a" + i });
  await assert.rejects(
    () => h.reserve({ botId: "b", agentId: "extra" }),
    /runtime_quota/,
  );
  await h.release({ botId: "b", agentId: "a" });
  await h.reserve({ botId: "b", agentId: "extra" });
});
test("silent shared event loop terminates once without restarting", async (t) => {
  const f = fixture(t),
    owner = { botId: "b", agentId: "a" };
  await f.h.reserve(owner);
  f.now = 10001;
  await f.h.sample();
  await f.h.sample();
  assert.equal(f.kills, 1);
  assert.equal(f.failures.length, 1);
  assert.equal(f.h.has(owner), false);
});
test("healthy async work survives, buffers count toward external memory", async (t) => {
  const f = fixture(t),
    owner = { botId: "b", agentId: "a" };
  await f.h.reserve(owner);
  f.now = 10001;
  f.h.heartbeat(owner);
  await f.h.sample();
  assert.equal(f.kills, 0);
  f.bytes = 256 * 1024 * 1024 + 1;
  await f.h.sample();
  assert.equal(f.kills, 1);
});
test("sampling errors fail closed", async (t) => {
  const f = fixture(t);
  await f.h.reserve({ botId: "b", agentId: "a" });
  f.h.measureTree = async () => {
    throw new Error("monitor failed");
  };
  await f.h.sample();
  assert.equal(f.failures.length, 1);
});
