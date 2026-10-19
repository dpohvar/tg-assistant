import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { createWidgetStore } from "./store.mjs";
import { createWidgetHost } from "./host.mjs";
import { createWidgetManager } from "./manager.mjs";
import { createWidgetRenderer } from "./render.mjs";
import { createWidgetAPI } from "./api.mjs";
import {createPublicationReceipts} from "./receipts.mjs";
import {createWidgetStop} from "./native-stop.mjs";
import { createWidgetTransport } from "./transport.mjs";
import { createProcessMonitor } from "./monitor.mjs";
import { launchSandbox } from "./sandbox.mjs";
import { buildWidget } from "./build.mjs";
import {createWidgetBuilder} from './builder.mjs';
import { validateWidgetState, widgetError } from "./contract.mjs";
import { createAccess } from "../access/scope.mjs";
const require = createRequire(import.meta.url);
export function createWidgetService({
  db,
  config,
  telegram,
  invoke,
  filesFor,
  notify,
  isUnavailable = () => false,
  inlineStore,
  guest,
}) {
  const store = createWidgetStore(db),
    access = createAccess(db);
  let manager,
    monitor,
    closed = false,
    materialized = new Map();
  const assets = (o) =>
      path.join(config.dataDir, "widgets", o.botId, o.agentId),
    snapshotPath = (id, o) => path.join(assets(o), "snapshots", id + ".mjs");
  function authorize(
    ref,
    target,
    { read = false, cleanup = false } = {},
    seen = new Set(),
  ) {
    if (closed || (!cleanup && isUnavailable(ref.botId, ref.agentId)))
      throw widgetError("widget_stopped");
    if (!cleanup && ref.widgetId && manager?.isRevoked(ref))
      throw widgetError("widget_stopped");
    if (!cleanup && ref.widgetId) {
      const key = `${ref.widgetId}:${ref.generation}`;
      if (seen.has(key)) throw widgetError("widget_stopped");
      seen.add(key);
      const origin = manager?.originFor(ref);
      if (origin) authorize(origin, undefined, {}, seen);
    }
    if (ref.widgetId) {
      const w = cleanup ? store.get(ref.widgetId) : store.current(ref);
      if (
        !w ||
        w.botId !== ref.botId ||
        w.agentId !== ref.agentId ||
        w.generation !== ref.generation
      )
        throw widgetError("widget_stopped");
    }
    const a = db.sql
        .prepare("SELECT * FROM agents WHERE botId=? AND agentId=?")
        .get(ref.botId, ref.agentId),
      chat = a && db.getChat(a.botId, a.chatId);
    if (
      !a ||
      !chat ||
      (!cleanup &&
        (!chat.agentEnabled ||
          a.stopPending ||
          (chat.chatType === "private" && !db.role(a.botId, a.chatId))))
    )
      throw widgetError("widget_stopped", "Owner agent is unavailable.");
    const scope = {
      botId: a.botId,
      agentId: a.agentId,
      chatId: a.chatId,
      widgetRef: ref,
    };
    if (target !== undefined)
      (read ? access.assertRead : access.assertWrite)(scope, target);
    return scope;
  }
  async function materialize(owner) {
    const dir = assets(owner);
    if (materialized.has(dir)) return materialized.get(dir);
    const p = (async () => {
      fs.mkdirSync(path.join(dir, "snapshots"), { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
      for(const entry of ['runtime.mjs','compiler-runtime.mjs'])await esbuild({
        entryPoints: [fileURLToPath(new URL('./'+entry, import.meta.url))],
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        external: ["esbuild"],
        outfile: path.join(dir, entry),
        banner: {
          js: "import {createRequire as __runtimeRequire} from 'node:module';const require=__runtimeRequire(import.meta.url);",
        },
        logLevel: "silent",
      });
      for (const name of ["jsx-runtime.mjs", "contract.mjs", "types.d.ts"])
        fs.copyFileSync(
          new URL("./" + name, import.meta.url),
          path.join(dir, name),
        );
      const modules = path.join(dir, "node_modules");
      fs.mkdirSync(modules, { recursive: true });
      const esbuildDir = path.dirname(require.resolve("esbuild/package.json"));
      fs.cpSync(esbuildDir, path.join(modules, "esbuild"), { recursive: true });
      const platformPackage = `@esbuild/${process.platform}-${process.arch}`,
        binDir = path.dirname(
          require.resolve(platformPackage + "/package.json"),
        );
      fs.mkdirSync(path.join(modules, "@esbuild"), { recursive: true });
      fs.cpSync(binDir, path.join(modules, platformPackage), {
        recursive: true,
      });
      const files = filesFor({ botId: owner.botId, agentId: owner.agentId }),
        sdk = "node_modules/@tg-assistant/widget";
      files.write(
        sdk + "/package.json",
        Buffer.from(
          JSON.stringify({
            name: "@tg-assistant/widget",
            type: "module",
            types: "types.d.ts",
            exports: {
              ".": { types: "./types.d.ts", default: "./jsx-runtime.mjs" },
              "./jsx-runtime": {
                types: "./types.d.ts",
                default: "./jsx-runtime.mjs",
              },
            },
          }),
        ),
      );
      for (const name of ["jsx-runtime.mjs", "contract.mjs", "types.d.ts"])
        files.write(
          sdk + "/" + name,
          fs.readFileSync(new URL("./" + name, import.meta.url)),
        );
      return dir;
    })();
    materialized.set(dir, p);
    try {
      return await p;
    } catch (e) {
      materialized.delete(dir);
      throw e;
    }
  }
  const callbackResponses = new Set();
  async function launch(owner, { heartbeat },entry='runtime.mjs') {
      const dir = await materialize(owner);
      monitor ??= createProcessMonitor({ dataDir: config.dataDir });
      let rpc;
      rpc = await createWidgetTransport({
        handle: async (method, args = {}) => {
          if (method === "heartbeat") {
            authorize({
              botId: owner.botId,
              agentId: owner.agentId,
              widgetId: null,
            });
            heartbeat();
            return;
          }
          if(entry!=='runtime.mjs')throw widgetError('access_denied','Compiler cannot issue widget operations.');
          const ref = args.ref;
          if (
            !ref ||
            ref.botId !== owner.botId ||
            ref.agentId !== owner.agentId
          )
            throw widgetError("access_denied");
          authorize(ref);
          if (method === "api") return api(ref, args.name, args.args);
          if (method === "save") {
            validateWidgetState(args.state);
            store.save(ref, { state: args.state });
            return;
          }
          if(method==='views')return store.listViews(ref.widgetId);
          if (method === "publish") {
            return manager.publish(ref,args.viewId,args.value);
          }
          if (method === "begin") {
            const event = await manager.begin(ref, args.token);
            const w = store.get(ref.widgetId);
            return { event, dropped: w.dropped };
          }
          if (method === "complete") {
            manager.complete(ref, args.token);
            return;
          }
          if (method === "drop") {
            if (args.event?.token) store.drop(ref, args.event.token);
            return;
          }
          if (method === "notifyError") {
            await manager.error(ref, args.error,args.viewId,{quiet:args.quiet});
            return;
          }
          if (method === "respond") {
            const key = ref.widgetId + ":" + args.callbackId;
            if (callbackResponses.has(key)) return;
            callbackResponses.add(key);
            if (callbackResponses.size > 10000)
              callbackResponses.delete(callbackResponses.values().next().value);
            let answer = args.answer;
            if (typeof answer === "string") answer = { text: answer };
            if (answer == null) answer = {};
            if (
              typeof answer !== "object" ||
              (answer.text !== undefined && typeof answer.text !== "string") ||
              (answer.showAlert !== undefined &&
                typeof answer.showAlert !== "boolean")
            )
              throw widgetError("invalid_argument");
            try {
              await telegram.call(owner.botId, "answerCallbackQuery", {
                callback_query_id: args.callbackId,
                ...(answer.text ? { text: answer.text } : {}),
                ...(answer.showAlert ? { show_alert: true } : {}),
              });
            } catch {}
            return;
          }
          throw widgetError("access_denied", "Unapproved runtime operation.");
        },
      });
      let child;
      try {
        child = launchSandbox(config, owner, dir, {
          ...rpc.bootstrap,
          owner,
          assets: dir,
        },{entry});
        child.request = rpc.request;
        child.close = async () => {
          child.stdin.destroy();
          await rpc.close();
        };
        child.ready = rpc.connected;
        child.on("error", () => void rpc.close());
        child.on("exit", () => void rpc.close());
        let count = 0;
        for (const stream of [child.stdout, child.stderr])
          stream.on("data", (bytes) => {
            count += bytes.length;
            if (count > 128 * 1024) stream.destroy();
          });
        child.identity = await monitor.identity(child.pid);
        return child;
      } catch (e) {
        if (child)
          try {
            if (child.identity) await monitor.terminateTree(child.identity);
            else child.kill();
          } catch {}
        await rpc.close();
        throw e;
      }
  }
  const host = createWidgetHost({
    launch,
    measureTree: (id) => monitor.measureTree(id),
    terminateTree: (id) => monitor.terminateTree(id),
    onFailure: (o, e) => manager.failure(o, e),
  });
  const compilerHost=createWidgetHost({
    launch:(owner,options)=>launch(owner,options,'compiler-runtime.mjs'),
    measureTree:id=>monitor.measureTree(id),terminateTree:id=>monitor.terminateTree(id),
  });
  const builder=createWidgetBuilder({host:compilerHost,authorize});
  const receipts=createPublicationReceipts({directory:ref=>path.join(assets(ref),"receipts")});
  const renderer = createWidgetRenderer({
    guest,
    store,
    db,
    telegram,
    filesFor,
    authorize,
    saveInline:(ref,id,content)=>inlineStore?.saveConfirmed(ref,id,content),
    journal:(ref,message,projection,view)=>receipts.write(ref,view,projection),
    completeJournal:(ref,id)=>{if(id)receipts.done(ref,id);},
  });
  const build = buildWidget({
    host:{request:(owner,_method,{handler})=>builder.compile(owner,handler)},
    persist: async (id, code, o) => {
      const dest = snapshotPath(id, o);
      fs.writeFileSync(dest, code, { mode: 0o600 });
    },
  });
  manager = createWidgetManager({
    guest,
    db,
    host,
    store,
    build,
    render: renderer,
    authorize,
    notify,
    snapshotPath,
    assertInlineOwner:(scope,id)=>{if(!inlineStore)throw widgetError('inline_message_unknown');inlineStore.assertOwner(scope,id);},
    recoverReceipts:(w,store)=>receipts.recover(w,store),
    removeReceipts:w=>receipts.remove(w),
    ackCallback:async (id,ref)=>{await telegram.call(ref.botId, 'answerCallbackQuery',{callback_query_id:id});},
  });
  const api = createWidgetAPI({
    authorize,
    manager,
    invoke,
    notify,
    stop:createWidgetStop({store,authorize,telegram}),
  });
  function collectSnapshots() {
    const root = path.join(config.dataDir, "widgets");
    if (!fs.existsSync(root)) return;
    for (const bot of fs
      .readdirSync(root, { withFileTypes: true })
      .filter((x) => x.isDirectory() && !x.isSymbolicLink()))
      for (const owner of fs
        .readdirSync(path.join(root, bot.name), { withFileTypes: true })
        .filter((x) => x.isDirectory() && !x.isSymbolicLink())) {
        const dir = path.join(root, bot.name, owner.name, "snapshots");
        if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) continue;
        const used = new Set(
          store
            .list({ botId: bot.name, agentId: owner.name })
            .map((w) => w.snapshotId + ".mjs"),
        );
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
          if (
            entry.isFile() &&
            /^[a-f0-9]{64}\.mjs$/.test(entry.name) &&
            !used.has(entry.name)
          )
            fs.unlinkSync(path.join(dir, entry.name));
      }
  }
  collectSnapshots();
  for(const method of ['disableOwner','removeOwner']){
    const operation=manager[method];manager[method]=async(owner,...args)=>{
      const [result]=await Promise.all([operation(owner,...args),builder.cancel(owner)]);return result;
    };
  }
  const close = manager.close;
  manager.close = async () => {
    await builder.close();
    await close();
    closed = true;
    monitor?.close();
    collectSnapshots();
  };
  manager.authorize = authorize;
  manager.renderer = renderer;
  return manager;
}
