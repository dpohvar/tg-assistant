import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BotFiles } from "../../src/files/paths.mjs";
import { planNativeEdit } from "../../src/messages/edit-plan.mjs";
import { createWidgetRenderer } from "../../src/widgets/render.mjs";

test("content and keyboard update use one native request; explicit flood rejection waits and rechecks authority", async () => {
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: 7,
    message: { message_id: 7, text: "old" },
  };
  const calls = [],
    waits = [];
  let authorized = 0;
  const markup = {
    inline_keyboard: [[{ text: "Next", callback_data: "next" }]],
  };
  const renderer = createWidgetRenderer({
    store: { current: () => w, patch: (_r, p) => Object.assign(w, p) },
    db: { saveMessage() {} },
    filesFor: () => ({}),
    authorize: () => {
      authorized++;
      return {};
    },
    sleep: async (ms) => waits.push(ms),
    telegram: {
      call: async (_b, method, args) => {
        calls.push({ method, args });
        if (calls.length === 1)
          throw Object.assign(new Error("Too Many Requests: retry after 1"), {
            code: "telegram_api_error",
            retryAfter: 1,
          });
        return { message_id: 7, text: "new", reply_markup: args.reply_markup };
      },
    },
  });
  await renderer.publish(w, { text: "new", reply_markup: markup });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((x) => x.method === "editMessageText"));
  assert.deepEqual(calls[1].args.reply_markup, markup);
  assert.equal(
    waits.reduce((a, b) => a + b, 0),
    1000,
  );
  assert.ok(authorized > 3);
});

test("a revoked generation cancels a flood wait before another Telegram request", async () => {
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: 7,
    message: { message_id: 7, text: "old" },
  };
  let revoked = false,
    calls = 0;
  const renderer = createWidgetRenderer({
    store: {
      current: () => w,
      patch: () => assert.fail("revoked render cannot commit"),
    },
    db: { saveMessage() {} },
    filesFor: () => ({}),
    authorize: () => {
      if (revoked)
        throw Object.assign(new Error("Stopped"), { code: "widget_stopped" });
      return {};
    },
    sleep: async () => {
      revoked = true;
    },
    telegram: {
      call: async () => {
        calls++;
        throw Object.assign(new Error("Too Many Requests"), {
          code: "telegram_api_error",
          retryAfter: 40,
        });
      },
    },
  });
  await assert.rejects(() => renderer.publish(w, { text: "new" }), {
    code: "widget_stopped",
  });
  assert.equal(calls, 1);
});

test("flood rejection does not retry initial sends or delay best-effort disabling", async () => {
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: null,
  };
  const calls = [];
  const renderer = createWidgetRenderer({
    store: { current: () => w, get: () => w, patch: () => {} },
    db: {
      getChat: () => ({ json: '{"id":1,"type":"private"}' }),
      saveMessage() {},
    },
    filesFor: () => ({}),
    authorize: () => ({}),
    sleep: async () =>
      assert.fail("send and cleanup must not wait for a retry"),
    telegram: {
      call: async (_bot, method) => {
        calls.push(method);
        throw Object.assign(new Error("Too Many Requests: retry after 41"), {
          code: "telegram_api_error",
          retryAfter: 41,
        });
      },
    },
  });
  await assert.rejects(() => renderer.publish(w, { text: "new" }), {
    code: "telegram_api_error",
  });
  w.messageId = 7;
  w.message = { message_id: 7, text: "old" };
  await renderer.disable(w);
  assert.deepEqual(calls, ["sendMessage", "editMessageReplyMarkup"]);
});
test("unchanged markup after a successful content edit is a successful render", async () => {
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: 7,
    message: { message_id: 7, text: "old" },
  };
  const renderer = createWidgetRenderer({
    store: { current: () => w, patch: (_r, p) => Object.assign(w, p) },
    db: { saveMessage() {} },
    filesFor: () => ({}),
    authorize: () => ({}),
    telegram: {
      call: async (_b, m) => {
        if (m === "editMessageReplyMarkup")
          throw Object.assign(
            new Error("Bad Request: message is not modified"),
            { code: "telegram_api_error" },
          );
        return { message_id: 7, text: "new" };
      },
    },
  });
  assert.equal((await renderer.publish(w, { text: "new" })).text, "new");
});
test("the renderer reuploads a changed local file even when render output is identical", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-render-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "x.jpg"), "first");
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: 7,
    message: { message_id: 7, photo: [{ file_id: "old" }] },
  };
  let uploads = 0;
  const renderer = createWidgetRenderer({
    store: { current: () => w, patch: (_r, p) => Object.assign(w, p) },
    db: { saveMessage() {} },
    filesFor: () => new BotFiles(root, "a"),
    authorize: () => ({}),
    telegram: {
      call: async (_b, m, _args, o) => {
        if (m === "editMessageMedia") {
          uploads += o.uploads.length;
          return { message_id: 7, photo: [{ file_id: "file" + uploads }] };
        }
        return true;
      },
    },
  });
  await renderer.publish(w, { photo: "file:x.jpg" });
  await renderer.publish(w, { photo: "file:x.jpg" });
  assert.equal(uploads, 1);
  fs.writeFileSync(path.join(root, "x.jpg"), "changed-longer");
  await renderer.publish(w, { photo: "file:x.jpg" });
  assert.equal(uploads, 2);
});
test("native edit retains reactions received while Telegram request was pending", async () => {
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: 7,
    message: { message_id: 7, chat: { id: 1 }, text: "Old" },
  };
  const renderer = createWidgetRenderer({
    store: { current: () => w, patch: (_r, p) => Object.assign(w, p) },
    db: { saveMessage() {} },
    filesFor: () => ({}),
    authorize: () => ({}),
    telegram: {
      call: async () => {
        w.message.reactions = { total_count: 2 };
        return { message_id: 7, chat: { id: 1 }, text: "New" };
      },
    },
  });
  await renderer.publish(w, { text: "New" });
  assert.equal(w.message.reactions.total_count, 2);
});
test("initial publication without topicId reaches native send exactly once", async () => {
  let calls = 0;
  const w = {
    widgetId: "w",
    botId: "b",
    agentId: "a",
    generation: 1,
    status: "active",
    chatId: 1,
    messageId: null,
    topicId: null,
  };
  const renderer = createWidgetRenderer({
    store: { current: () => w, patch: (_r, p) => Object.assign(w, p) },
    db: {
      getChat: () => ({ json: '{"id":1,"type":"private"}' }),
      saveMessage() {},
    },
    telegram: {
      call: async () => {
        calls++;
        return { message_id: 7, text: "ok" };
      },
    },
    authorize: () => ({}),
    filesFor: () => ({}),
  });
  assert.equal((await renderer.publish(w, { text: "ok" })).message_id, 7);
  assert.equal(calls, 1);
});
test("native conversion planner edits one message and leaves admissibility to Telegram", () => {
  assert.deepEqual(
    planNativeEdit({ text: "Old" }, { photo: "id", caption: "New" })[0],
    {
      method: "editMessageMedia",
      fields: { media: { type: "photo", media: "id", caption: "New" } },
    },
  );
  assert.equal(
    planNativeEdit({ photo: [{ file_id: "x" }] }, { text: "New" })[0].method,
    "editMessageText",
  );
  assert.equal(
    planNativeEdit(
      { location: {} },
      { location: { latitude: 1, longitude: 2 } },
    )[0].method,
    "editMessageLiveLocation",
  );
});
test("dice and poll updates edit keyboards without rerolling or recreating", () => {
  assert.deepEqual(
    planNativeEdit(
      { dice: { value: 3 } },
      { dice: { emoji: "🎲" }, reply_markup: { inline_keyboard: [] } },
    ),
    [
      {
        method: "editMessageReplyMarkup",
        fields: { reply_markup: { inline_keyboard: [] } },
      },
    ],
  );
  assert.equal(
    planNativeEdit(
      { poll: {} },
      {
        poll: { question: "Q", options: [] },
        reply_markup: { inline_keyboard: [] },
      },
    ).length,
    1,
  );
});
