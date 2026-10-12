import test from "node:test";
import assert from "node:assert/strict";
import { buildWidget, compileWidget } from "../../src/widgets/build.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("missing handler gives authoring guidance instead of an unresolved dependency", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "widget-missing-handler-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await assert.rejects(
    () =>
      compileWidget("widgets/counter.tsx", { cwd, agentId: "a", assets: cwd }),
    /Handler file.*not found.*write.*set_widget/i,
  );
});
test("build outputs are immutable validated snapshots with no outside assets", async () => {
  const write = [];
  const build = buildWidget({
    host: {
      request: async () => ({
        code: 'export function render(){return {text:"OK"}}',
        manifest: ["inside.tsx"],
      }),
    },
    persist: async (id, code) => {
      write.push({ id, code });
      return id;
    },
  });
  const r = await build({ botId: "b", agentId: "a" }, "inside.tsx");
  assert.match(r.snapshotId, /^[a-f0-9]{64}$/);
  assert.equal(write[0].code.includes("OK"), true);
  const invalid = buildWidget({
    host: { request: async () => ({ code: "x", manifest: ["../escape"] }) },
    persist: async () => assert.fail("must reject"),
  });
  await assert.rejects(
    () => invalid({ botId: "b", agentId: "a" }, "w.tsx"),
    /sandbox_unavailable/,
  );
});
