// Native, credential-free protocol acceptance; no turn/start or Telegram calls.
// node test/manual/codex-tool-registration.mjs ABSOLUTE_CODEX_EXECUTABLE [--compare]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import readline from "node:readline";
import { RpcProcess } from "../../src/codex/rpc.mjs";
import { dynamicTools } from "../../src/codex/threads.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-tool-registration-"));
const env = { ...process.env, CODEX_HOME: path.join(root, "codex-home") };
for (const key of Object.keys(env))
  if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)) delete env[key];
fs.mkdirSync(env.CODEX_HOME, { recursive: true });
async function attempt(label, tools) {
  const rpc = new RpcProcess({
    executable: process.argv[2],
    args: ["app-server", "--stdio", "--strict-config"],
    cwd: root,
    env,
  });
  let rejection;
  const output = readline.createInterface({ input: rpc.child.stdout });
  output.on("line", (line) => {
    try {
      const m = JSON.parse(line);
      if (m.error) rejection = { code: m.error.code, message: m.error.message };
    } catch {}
  });
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "tg_tool_registration_check", version: "1" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify("initialized");
    const started = await rpc.request("thread/start", {
      cwd: root,
      approvalPolicy: "never",
      dynamicTools: tools,
    });
    assert.ok(started.thread.id);
    console.log(
      JSON.stringify({
        check: label,
        status: "passed",
        tools: tools.length,
        threadStart: true,
      }),
    );
    await rpc.request("thread/delete", { threadId: started.thread.id });
    return true;
  } catch (e) {
    console.log(
      JSON.stringify({
        check: label,
        status: "failed",
        error: rejection ?? { message: e.message },
      }),
    );
    return false;
  } finally {
    output.close();
    await rpc.close();
  }
}
try {
  const passed = await attempt(
    "production dynamic tool registration",
    dynamicTools,
  );
  if (process.argv.includes("--compare"))
    await attempt(
      "same tools with function discriminator",
      dynamicTools.map((tool) => ({ type: "function", ...tool })),
    );
  if (!passed) process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
