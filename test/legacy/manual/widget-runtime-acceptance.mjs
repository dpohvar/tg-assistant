import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetService } from "../../src/widgets/service.mjs";
import { BotFiles } from "../../src/files/paths.mjs";
const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "widget-runtime-acceptance-"),
  ),
  db = openDatabase(path.join(root, "control", "db.sqlite"));
const config = {
  dataDir: path.join(root, "control"),
  botsDir: path.join(root, "bots"),
  codexExecutable: process.argv[2],
};
if (!config.codexExecutable)
  throw new Error("Pass absolute Codex executable path.");
db.registerBot({ botId: "b", telegramId: 42, username: "fixture", ownerId: 1 });
db.saveChat("b", { id: 1, type: "private", first_name: "Fixture" });
const agent = db.ensureAgent("b", 1),
  scope = { botId: "b", agentId: agent.agentId, chatId: 1 },
  wiki = path.join(config.botsDir, "b");
fs.mkdirSync(wiki, { recursive: true });
fs.writeFileSync(path.join(wiki, "package.json"), '{"type":"module"}');
fs.writeFileSync(
  path.join(wiki, "handler.tsx"),
  `export function render(state){return {text:<b>Count {state.count??0}</b>,reply_markup:{inline_keyboard:[[{text:'Next',callback_data:'next'}]]}}} export function onInit(ctx){ctx.state.count??=0} export function next(ctx){ctx.state.count++} `,
);
const calls = [],
  notices = [];
let nextId = 7;
const options = {
  db,
  config,
  telegram: {
    call: async (_b, method, args) => {
      calls.push(method);
      return {
        message_id: args.message_id ?? nextId++,
        date: 1,
        chat: { id: 1, type: "private" },
        text: args.text ?? "Count",
        reply_markup: args.reply_markup,
        ...(method === "sendDice" ? { dice: { emoji: "🎲", value: 4 } } : {}),
        ...(args.location ? { location: args.location } : {}),
      };
    },
  },
  invoke: async () => ({}),
  filesFor: (s) => new BotFiles(path.join(config.botsDir, s.botId), s.agentId),
  notify: async (_s, e) => notices.push(e),
};
let service = createWidgetService(options);
async function until(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("Acceptance condition timed out.");
}
async function action(widgetId, name, data) {
  await service.event(scope, { widgetId, name, data });
  await until(() => service.store.get(widgetId).pending === 0);
  await new Promise((r) => setTimeout(r, 150));
}
try {
  const c = await service.set(scope, {
    handler: "handler.tsx",
    description: "Runtime acceptance",
  });
  assert.equal(c.messageId, 7);
  await action(c.widgetId, "next");
  assert.equal(service.state(scope, { widgetId: c.widgetId }).count, 1);
  assert.equal(calls.filter((x) => x.startsWith("send")).length, 1);
  if (process.argv.includes("--extended")) {
    const report = (name) =>
      console.log(
        JSON.stringify({
          platform: process.platform,
          check: name,
          passed: true,
        }),
      );
    await service.delete(scope, { widgetId: c.widgetId });
    const examples = new URL(
      "../../docs/dev/examples/widgets/",
      import.meta.url,
    );
    for (const entry of fs.readdirSync(examples)) {
      fs.copyFileSync(new URL(entry, examples), path.join(wiki, entry));
      const w = await service.set(scope, {
        handler: entry,
        description: "Example " + entry,
      });
      assert.ok(service.store.get(w.widgetId).messageId);
      await service.delete(scope, { widgetId: w.widgetId });
    }
    report("all examples: real sandbox build/init/render/create/cleanup");
    const foreign = path.join(root, "bots", "foreign", "private.txt"),
      secret = path.join(config.dataDir, "private.txt");
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, "synthetic");
    fs.writeFileSync(secret, "synthetic");
    process.env.WIDGET_ACCEPTANCE_SECRET = "synthetic";
    const forbidden = [
      foreign,
      secret,
      path.join(wiki, ".git", "canary"),
      path.join(wiki, ".temp", "foreign", "canary"),
    ];
    fs.mkdirSync(path.dirname(forbidden[3]), { recursive: true });
    fs.writeFileSync(forbidden[2], "synthetic");
    fs.writeFileSync(forbidden[3], "synthetic");
    fs.writeFileSync(
      path.join(wiki, "isolation.ts"),
      `import fs from 'node:fs';export function render(s){return {text:JSON.stringify(s)}}export function inspect(ctx){ctx.state.denied=${JSON.stringify(forbidden)}.map(p=>{try{fs.readFileSync(p);return false;}catch{return true;}});ctx.state.noSecret=process.env.WIDGET_ACCEPTANCE_SECRET===undefined;}`,
    );
    const isolated = await service.set(scope, {
      handler: "isolation.ts",
      description: "Isolation probe",
    });
    await action(isolated.widgetId, "inspect");
    assert.deepEqual(
      service.state(scope, { widgetId: isolated.widgetId }).denied,
      [true, true, true, true],
    );
    assert.equal(
      service.state(scope, { widgetId: isolated.widgetId }).noSecret,
      true,
    );
    await service.delete(scope, { widgetId: isolated.widgetId });
    report("filesystem and environment isolation");
    fs.writeFileSync(
      path.join(wiki, "replace.ts"),
      `export function render(s){return {text:'generation '+(s.count??0)}}export async function replace(ctx){await ctx.api.set_widget({widgetId:ctx.widgetId,handler:'handler.tsx',description:'Self replacement',state:{count:20}});try{ctx.state.count=99;await ctx.render();}catch{}}`,
    );
    const replaced = await service.set(scope, {
      handler: "replace.ts",
      description: "Replacement probe",
    });
    await action(replaced.widgetId, "replace");
    assert.equal(service.store.get(replaced.widgetId).generation, 2);
    assert.equal(
      service.state(scope, { widgetId: replaced.widgetId }).count,
      20,
    );
    await service.close();
    service = createWidgetService(options);
    await service.recover();
    await action(replaced.widgetId, "next");
    assert.equal(
      service.state(scope, { widgetId: replaced.widgetId }).count,
      21,
    );
    await service.delete(scope, { widgetId: replaced.widgetId });
    report("self replacement, stale effects fenced, restart");
    fs.writeFileSync(
      path.join(wiki, "async.ts"),
      `export function render(s){return {text:String(s.done??false)}}export async function wait(ctx){await new Promise(r=>setTimeout(r,12000));ctx.state.done=true;}`,
    );
    const asyncWidget = await service.set(scope, {
      handler: "async.ts",
      description: "Long asynchronous operation",
    });
    await service.event(scope, {
      widgetId: asyncWidget.widgetId,
      name: "wait",
    });
    await until(
      () =>
        service.state(scope, { widgetId: asyncWidget.widgetId }).done === true,
      16000,
    );
    assert.equal(service.store.get(asyncWidget.widgetId).status, "active");
    await service.delete(scope, { widgetId: asyncWidget.widgetId });
    report("long async action keeps heartbeat healthy");
    const marker = path.join(wiki, "child-heartbeat");
    fs.writeFileSync(
      path.join(wiki, "child.ts"),
      `import {spawn} from 'node:child_process';export function render(s){return {text:String(s.pid??'ready')}}export async function start(ctx){const c=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('node:fs');setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(Date.now())),100)`)}],{detached:true,stdio:'ignore'});c.unref();ctx.state.pid=c.pid;await ctx.render();}`,
    );
    const childWidget = await service.set(scope, {
      handler: "child.ts",
      description: "Detached child probe",
    });
    await action(childWidget.widgetId, "start");
    await until(() => fs.existsSync(marker));
    await new Promise((r) => setTimeout(r, 1500));
    await service.disableOwner(scope, "probe");
    const before = fs.readFileSync(marker, "utf8");
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(fs.readFileSync(marker, "utf8"), before);
    await service.delete(scope, { widgetId: childWidget.widgetId });
    report("tracked detached child is terminated");
    fs.writeFileSync(
      path.join(wiki, "hang.ts"),
      `export function render(s){return {text:'Hang ready'}}export function hang(){while(true){}}`,
    );
    const hung = await service.set(scope, {
      handler: "hang.ts",
      description: "Watchdog probe",
      state: { committed: true },
    });
    await service.event(scope, { widgetId: hung.widgetId, name: "hang" });
    await until(
      () => service.store.get(hung.widgetId).status === "disabled",
      16000,
    );
    assert.deepEqual(service.state(scope, { widgetId: hung.widgetId }), {
      committed: true,
    });
    await service.delete(scope, { widgetId: hung.widgetId });
    report("synchronous hang disables owner runtime");
    fs.writeFileSync(
      path.join(wiki, "memory.ts"),
      `let bytes;export function render(){return {text:'Memory ready'}}export async function allocate(){bytes=Buffer.alloc(350*1024*1024,1);await new Promise(r=>setTimeout(r,15000));}`,
    );
    const memory = await service.set(scope, {
      handler: "memory.ts",
      description: "Buffer memory probe",
    });
    await service.event(scope, { widgetId: memory.widgetId, name: "allocate" });
    await until(() => service.store.get(memory.widgetId).status === "disabled");
    await service.delete(scope, { widgetId: memory.widgetId });
    report("external memory monitor covers Buffers");
    fs.writeFileSync(
      path.join(wiki, "cleanup.ts"),
      `export function render(){return {text:'Cleanup ready'}}export async function onStop(){await new Promise(()=>{})}`,
    );
    const cleanup = await service.set(scope, {
        handler: "cleanup.ts",
        description: "Cleanup timeout probe",
      }),
      start = Date.now();
    await service.delete(scope, { widgetId: cleanup.widgetId });
    assert.ok(Date.now() - start < 9000);
    assert.equal(service.store.get(cleanup.widgetId), null);
    report("bounded cleanup timeout");
  }
  console.log(
    JSON.stringify({
      platform: process.platform,
      node: process.version,
      root,
      passed: true,
      calls: calls.length,
      notices: notices.map((e) => e.eventType),
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ phase: "failed", root, notices }));
  throw error;
} finally {
  await service.close();
  db.close();
}
