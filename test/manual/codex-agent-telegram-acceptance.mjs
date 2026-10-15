// Opt-in: two real model turns and Telegram sends on the designated test bot.
// node test/manual/codex-agent-telegram-acceptance.mjs PRIVATE_CONFIG [CODEX_BINARY]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/storage/database.mjs";
import { createTelegram } from "../../src/telegram/api.mjs";
import { createController } from "../../src/controller.mjs";
import { CodexAgent } from "../../src/codex/threads.mjs";
import { acceptanceSend } from "../helpers/acceptance-send.mjs";

const source = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const registry = new DatabaseSync(
  path.join(source.dataDir, "controller.sqlite"),
  { readOnly: true },
);
const registered = registry
  .prepare("SELECT * FROM bots WHERE telegramId=?")
  .get(8768223629);
registry.close();
assert.equal(registered?.username, "dpohvar_test_pub_bot");
assert.equal(registered.ownerId, 114772672);
const token = fs.readFileSync(registered.secretRef, "utf8").trim(),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-native-agent-"));
const config = {
  ...source,
  dataDir: path.join(root, "control"),
  botsDir: path.join(root, "bots"),
  codexExecutable: process.argv[3] ?? source.codexExecutable,
};
const db = openDatabase(path.join(config.dataDir, "controller.sqlite")),
  messages = [],
  errors = [];
const native = createTelegram({ getToken: () => token }),
  botId = "live-test",
  chatId = registered.ownerId;
const telegram = {
  ...native,
  async call(b, method, args, options) {
    const r = await native.call(b, method, args, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
    if (method === "sendMessage") messages.push(r);
    return r;
  },
};
const agent = new CodexAgent({ db, config }),
  c = createController({
    db,
    agent,
    config,
    telegram,
    onError: (e) => errors.push(e),
  });
let scope,
  failed = false,
  cleanupFailed = false;
const safe = (e) =>
  String(e?.message ?? e)
    .replaceAll(token, "[redacted]")
    .slice(0, 1000);
try {
  const me = await telegram.call(botId, "getMe");
  assert.equal(me.id, registered.telegramId);
  const chat = await telegram.call(botId, "getChat", { chat_id: chatId });
  assert.equal(chat.type, "private");
  db.registerBot({
    botId,
    telegramId: me.id,
    username: me.username,
    ownerId: chatId,
  });
  db.saveChat(botId, chat);
  scope = c.lifecycle.scope(db.ensureAgent(botId, chatId));
  await c.ready;
  for (const phase of ["start", "resume"]) {
    const marker = `LIVE CHECK: Codex tool registration ${phase} OK`;
    const work = agent.run(
      scope,
      [
        {
          eventType: "message",
          messageId: 0,
          textPlain: `This is an authorized bounded acceptance test. Use the controller send tool exactly once to send this exact text to this current chat: ${marker}. Set disable_notification:true. Do not call other tools or access files. Then end the turn.`,
          from: { userId: chatId, name: "Test owner" },
        },
      ],
      acceptanceSend({
        invoke: (name, args) => c.invoke(scope, name, args),
        chatId,
        marker,
      }),
    );
    let timer;
    try {
      const result = await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native agent acceptance timed out")),
            120000,
          );
        }),
      ]);
      await result.settled;
    } finally {
      clearTimeout(timer);
    }
    assert.ok(
      messages.at(-1)?.text.includes(marker),
      "Telegram response must contain this phase marker",
    );
    assert.equal(messages.length, phase === "start" ? 1 : 2);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        check: `real model ${phase}, dynamic send, Telegram receipt`,
        status: "passed",
      }),
    );
    if (phase === "start") await agent.detach(scope.agentId);
  }
} catch (e) {
  failed = true;
  console.log(
    JSON.stringify({
      check: "native agent acceptance",
      status: "failed",
      description: safe(e),
    }),
  );
} finally {
  if (scope)
    try {
      await agent.deleteSession(
        scope.agentId,
        db.agent(botId, chatId)?.threadId,
      );
    } catch (e) {
      failed = true;
      cleanupFailed = true;
      console.log(
        JSON.stringify({
          check: "test session cleanup",
          status: "failed",
          description: safe(e),
        }),
      );
    }
  c.close();
  await c.idle();
  for (const m of messages)
    try {
      await native.call(
        botId,
        "deleteMessage",
        { chat_id: chatId, message_id: m.message_id },
        { signal: AbortSignal.timeout(30000) },
      );
    } catch (e) {
      failed = true;
      cleanupFailed = true;
      console.log(
        JSON.stringify({
          check: "test message cleanup",
          status: "failed",
          description: safe(e),
        }),
      );
    }
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    check: "summary",
    status: failed ? "failed" : "passed",
    realModelTurns: messages.length,
    fixturesDeleted: !cleanupFailed,
  }),
);
if (failed) process.exitCode = 1;
