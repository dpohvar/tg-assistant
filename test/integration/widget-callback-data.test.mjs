import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
import { createWidgetEvents } from "../../src/widgets/events.mjs";
import { createWidgetRenderer } from "../../src/widgets/render.mjs";
import { createRuntime } from "../../src/widgets/runtime.mjs";
import { HOOKS, validateWidgetEvent } from "../../src/widgets/contract.mjs";
import { jsx, Fragment, normalizeRender } from "../../src/widgets/jsx-runtime.mjs";

const keyboard = (data) => ({
  text: "Buttons",
  reply_markup: { inline_keyboard: Array.from({ length: Math.ceil(data.length / 8) }, (_, i) =>
    data.slice(i * 8, i * 8 + 8).map((callback_data) => ({ text: "Button", callback_data }))) },
});

test("void is reserved only for buttons; named agent/widget/local events keep their behavior", async (t) => {
  for (const source of ["agent", "widget", "local"])
    for (const name of ["void", "void:payload"])
      assert.doesNotThrow(() => validateWidgetEvent({
        name, source, data: {}, receivedAt: new Date().toISOString(), delayed: false,
      }));
  let ran = false;
  const ref = { botId: "b", agentId: "a", widgetId: "w", generation: 1 };
  const runtime = createRuntime({ bridge: async () => {} });
  t.after(() => runtime.close());
  await runtime.load(ref, { module: {
    render: () => ({ text: "Named action" }),
    onInit(ctx) { ctx.enqueue("void"); },
    ["void"]() { ran = true; },
  } });
  await runtime.hook(ref, "onInit");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ran, true);
});

test("callback prefixes reject every system export and reserved name in inline and nested rich buttons", () => {
  for (const name of [...HOOKS, "__proto__", "constructor", "prototype", "then", "__render", "void"]) {
    for (const data of [`${name}:x`, `${name}:`, `${name}:a:b`]) {
      assert.throws(() => normalizeRender(keyboard([data])), /invalid_argument/, data);
      assert.throws(() => normalizeRender(jsx(Fragment, {
        children: jsx("details", { children: [
          jsx("summary", { children: "Hidden buttons" }),
          jsx("p", { children: jsx("tg-button", { type: "callback_data", data, children: "Button" }) }),
        ] }),
      })), /invalid_argument/, data);
    }
  }
});

test("callback length uses the whole UTF-8 string; empty action prefixes are rejected", () => {
  for (const data of [null, 7, {}, "", ":data", ":", "cell:" + "я".repeat(30), "cell:" + "a".repeat(60)])
    assert.throws(() => normalizeRender(keyboard([data])), /invalid_argument/, data);
  for (const data of ["void", "next", "cell:", "cell:a:b", "cell:render:onInit:void", "cell:" + "я".repeat(29) + "x"])
    assert.doesNotThrow(() => normalizeRender(keyboard([data])), data);
});

test("60+ buttons need one group export; void needs none and missing group exports still fail", async (t) => {
  const ref = { botId: "b", agentId: "a", widgetId: "w", generation: 1 };
  const runtime = createRuntime({ bridge: async () => {} });
  t.after(() => runtime.close());
  const data = ["void", ...Array.from({ length: 64 }, (_, i) => `cell:${i}`)];
  for (const rich of [false, true]) {
    await runtime.load(ref, { module: {
      render: () => rich ? jsx(Fragment, { children: keyboard(data).reply_markup.inline_keyboard.map((row) =>
        jsx("tg-button-row", { children: row.map((b) => jsx("tg-button", {
          type: "callback_data", data: b.callback_data, children: b.text,
        })) })) }) : keyboard(data),
      cell() {},
    } });
    const rendered = await runtime.render(ref);
    assert.equal(rich ? rendered.rich_message.blocks.flatMap((row) => row.buttons).length
      : rendered.reply_markup.inline_keyboard.flat().length, 65);
  }
  await runtime.load(ref, { module: { render: () => keyboard(["missing:1", "void"]) } });
  await assert.rejects(() => runtime.render(ref), /No exported action missing/);
});

function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.registerBot({ botId: "b", telegramId: 42, username: "bot", ownerId: 1 });
  db.saveChat("b", { id: -1, type: "supergroup", title: "Fixture" });
  const a = db.ensureAgent("b", -1);
  const store = createWidgetStore(db);
  const w = store.create({
    botId: "b", agentId: a.agentId, chatId: -1, messageId: 7,
    description: "Buttons", handler: "w.tsx", snapshotId: "s", state: {},
    message: { message_id: 7, chat: { id: -1, type: "supergroup" }, text: "Old" },
    status: "active",
  });
  const acks = [], events = [];
  const route = createWidgetEvents({ db, manager: {
    store, hasHook: () => true,
    admit: async (ref, event) => {
      events.push(event);
      return store.admit(ref, event, { durable: false });
    },
  }, telegram: { call: async (_b, _m, args) => acks.push(args) } });
  const callback = (data, messageId = 7, chatId = -1, botId = "b") => route(botId, { callback_query: {
    id: "cb", data, from: { id: 2 }, message: { message_id: messageId, chat: { id: chatId } },
  } });
  const telegram = { call: async (_b, _m, args) => ({
      message_id: 7, chat: { id: -1, type: "supergroup" },
      ...(args.rich_message ? { rich_message: args.rich_message } : { text: args.text }),
      reply_markup: args.reply_markup,
    }) };
  const renderer = createWidgetRenderer({ store, db, filesFor: () => ({}), authorize: () => ({}),
    telegram,
  });
  return { db, store, w, acks, events, callback, renderer, telegram };
}

test("registered void callbacks acknowledge immediately without queue/state/render effects", async (t) => {
  const f = fixture(t);
  await f.renderer.publish(f.w, keyboard(["void", "cell:1"]));
  const before = f.store.get(f.w.widgetId);
  assert.equal(await f.callback("void"), true);
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.acks, [{ callback_query_id: "cb" }]);
  assert.deepEqual(f.store.get(f.w.widgetId), before);
});

test("only exact registered data dispatches; prefixes, unknown payloads, other chats and messages do not", async (t) => {
  const f = fixture(t);
  await f.renderer.publish(f.w, keyboard(["cell:1:2", "next"]));
  for (const value of ["cell", "cell:999", "cell:1:2:3", "void", "render:x", "onInit:x"])
    assert.equal(await f.callback(value), true);
  assert.equal(await f.callback("cell:1:2", 8), false);
  assert.equal(await f.callback("cell:1:2", 7, -2), false);
  assert.equal(await f.callback("cell:1:2", 7, -1, "other-bot"), false);
  assert.equal(f.events.length, 0);
  assert.equal(await f.callback("cell:1:2"), true);
  assert.equal(f.events[0].name, "cell");
  assert.equal(f.events[0].data.data, "cell:1:2");
  assert.equal(f.events[0].user.id, 2);
  assert.equal(await f.callback("next"), true);
  assert.equal(f.events[1].name, "next");
  assert.equal(f.store.get(f.w.widgetId).pending, 2);
});

test("failed publication preserves the previous registry and cannot authorize new buttons", async (t) => {
  const f = fixture(t);
  await f.renderer.publish(f.w, keyboard(["cell:old"]));
  f.telegram.call = async () => {
    throw Object.assign(new Error("Bad Request: fixture failure"), { code: "telegram_api_error" });
  };
  await assert.rejects(() => f.renderer.publish(f.w, keyboard(["cell:new"])), /fixture failure/);
  assert.deepEqual(f.store.get(f.w.widgetId).buttonNames, ["cell:old"]);
  await f.callback("cell:new");
  assert.equal(f.events.length, 0);
  await f.callback("cell:old");
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].data.data, "cell:old");
});

test("registry refresh removes old payloads and retains nested rich and inline callback strings exactly", async (t) => {
  const f = fixture(t);
  await f.renderer.publish(f.w, keyboard(["cell:old"]));
  await f.renderer.publish(f.w, {
    rich_message: { blocks: [{ type: "details", header: "Buttons", blocks: [
      { type: "paragraph", text: [{ type: "button", button: { text: "New", callback_data: "cell:new:2" } }] },
      { type: "buttons", buttons: [{ text: "Blank", callback_data: "void" }] },
    ] }] },
    reply_markup: { inline_keyboard: [[{ text: "Next", callback_data: "next" }]] },
  });
  assert.deepEqual(f.store.get(f.w.widgetId).buttonNames, ["cell:new:2", "void", "next"]);
  await f.callback("cell:old");
  assert.equal(f.events.length, 0);
  await f.callback("cell:new:2");
  assert.equal(f.events[0].name, "cell");
  assert.equal(f.events[0].data.data, "cell:new:2");
  await f.renderer.publish(f.w, { text: "No buttons" });
  assert.deepEqual(f.store.get(f.w.widgetId).buttonNames, []);
  await f.callback("cell:new:2");
  assert.equal(f.events.length, 1);
});

test("disabled widgets ignore registered group and void callbacks", async (t) => {
  const f = fixture(t);
  await f.renderer.publish(f.w, keyboard(["cell:1", "void"]));
  f.store.patch(f.w, { status: "disabled" });
  await f.callback("cell:1");
  await f.callback("void");
  assert.equal(f.events.length, 0);
  assert.equal(f.acks.length, 2);
});

test("a legacy registry containing reserved prefixes cannot invoke system hooks", async (t) => {
  const f = fixture(t);
  f.store.patch(f.w, { buttonNames: ["render:x", "onInit:x", "__render:x", "void:x", ":x"] });
  for (const value of f.store.get(f.w.widgetId).buttonNames)
    assert.equal(await f.callback(value), true);
  assert.equal(f.events.length, 0);
  assert.equal(f.acks.length, 5);
});

test("routed group callbacks execute the single export and preserve the native callback answer", async (t) => {
  const f = fixture(t);
  const answers = [];
  const runtime = createRuntime({ bridge: async (method, args) => {
    if (method === "respond") answers.push(args);
    if (method === "save") f.db.sql.prepare("UPDATE widgets SET state=? WHERE widgetId=?").run(JSON.stringify(args.state), f.w.widgetId);
    if (method === "publish") return f.renderer.publish(f.w, args.value);
    if (method === "notifyError" || method === "drop") assert.fail(JSON.stringify(args));
  } });
  t.after(() => runtime.close());
  await runtime.load(f.w, { state: {}, message: f.w.message, module: {
    render: () => keyboard(["cell:a:b", "cell:", "void"]),
    cell(ctx, event) {
      ctx.state.selected = event.data.data.slice("cell:".length);
      return { text: `Selected ${ctx.state.selected}`, showAlert: true };
    },
  } });
  await f.renderer.publish(f.w, await runtime.render(f.w));
  for (const data of ["cell:a:b", "cell:"]) {
    await f.callback(data);
    const head = f.store.head(f.w);
    const event = f.store.begin(f.w, head.seq);
    await runtime.dispatch(f.w, event);
    f.store.complete(f.w, head.seq);
  }
  assert.equal(answers.length, 2);
  assert.equal(answers[0].answer.text, "Selected a:b");
  assert.equal(answers[0].answer.showAlert, true);
  assert.equal(answers[1].answer.text, "Selected ");
  assert.equal(f.store.get(f.w.widgetId).state.selected, "");
});
