import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileWidget } from "../../src/widgets/build.mjs";
import { createRuntime } from "../../src/widgets/runtime.mjs";
const examples = fileURLToPath(
  new URL("../../docs/dev/examples/widgets/", import.meta.url),
);
test("all shipped examples compile and exercise render/action/error/creation traces", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-examples-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, "sdk");
  fs.mkdirSync(assets);
  for (const f of ["jsx-runtime.mjs", "contract.mjs"])
    fs.copyFileSync(
      new URL("../../src/widgets/" + f, import.meta.url),
      path.join(assets, f),
    );
  const cases = [
    ["pagination.tsx", "next", {}, (s) => assert.equal(s.page, 1)],
    [
      "consent-voting.tsx",
      "join",
      {},
      (s) => assert.equal(s.participants["1"], true),
    ],
    ["timer.tsx", "tick", 123, (s) => assert.equal(s.updatedAt, 123)],
    [
      "websocket-display.tsx",
      "update",
      "Hello",
      (s) => assert.equal(s.last, "Hello"),
    ],
    ["dice-onCreate.tsx", "explain", {}, (s) => assert.equal(s.value, 4)],
    [
      "rich-media-update.tsx",
      "update",
      { src: "https://example.com/photo.jpg" },
      (s) => assert.equal(s.src, "https://example.com/photo.jpg"),
    ],
    [
      "live-location.tsx",
      "move",
      { latitude: 1, longitude: 2 },
      (s) => assert.equal(s.latitude, 1),
    ],
    [
      "error-repair.tsx",
      "fail",
      {},
      (s) => assert.match(s.lastError, /Demonstration/),
    ],
  ];
  for (const [file, action, data, check] of cases)
    await t.test(file, async () => {
      fs.copyFileSync(path.join(examples, file), path.join(root, file));
      const built = await compileWidget(file, {
        cwd: root,
        agentId: "a",
        assets,
      });
      const output = path.join(root, file + ".mjs");
      fs.writeFileSync(output, built.code);
      const mod = await import(pathToFileURL(output));
      let saved = {},
        notifications = 0;
      const runtime = createRuntime({
          bridge: async (name, args) => {
            if (name === "save") saved = structuredClone(args.state);
            if (name === "notifyError") notifications++;
            if (name === "publish")
              return { message_id: 7, dice: { value: 4 } };
          },
        }),
        ref = { botId: "b", agentId: "a", widgetId: file, generation: 1 };
      try {
        await runtime.load(ref, {
          state: {},
          message: { message_id: 7, dice: { value: 4 } },
          module: mod,
        });
        await runtime.hook(ref, "onInit");
        await runtime.hook(ref, "onCreate");
        assert.ok(await runtime.render(ref));
        await runtime.dispatch(ref, {
          name: action,
          source: "agent",
          user: { id: 1 },
          data,
        });
        check(saved);
        assert.equal(notifications, 0);
      } finally {
        await runtime.close();
      }
    });
});
