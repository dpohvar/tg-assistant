import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sandboxLaunchSpec } from "../../src/widgets/sandbox.mjs";
test("widget sandbox grants exact owner assets and a constructed environment", () => {
  const config = {
    botsDir: path.resolve("bots"),
    dataDir: path.resolve("control"),
    codexExecutable: path.resolve("codex/codex.exe"),
    codexHome: path.resolve("auth"),
  };
  const s = sandboxLaunchSpec(
    config,
    { botId: "b", agentId: "a" },
    path.resolve("control/widget-runtime/b/a"),
    { platform: "win32" },
  );
  assert.equal(s.permissions[path.join(config.botsDir, "b", ".git")], "deny");
  assert.equal(s.permissions[path.join(config.botsDir, "b", ".temp")], "deny");
  assert.equal(
    s.permissions[path.join(config.botsDir, "b", ".temp", "a")],
    "write",
  );
  assert.equal(s.permissions[config.dataDir], undefined);
  assert.equal(s.permissions[config.codexHome], undefined);
  assert.equal(s.env.CODEX_HOME, undefined);
  assert.equal(s.env.TELEGRAM_TOKEN, undefined);
  assert.ok(s.args.includes("prefer_mxc"));
  assert.ok(s.args.includes("--preserve-symlinks-main"));
  if (process.env.LOCALAPPDATA)
    assert.equal(s.env.LOCALAPPDATA, process.env.LOCALAPPDATA);
});
