import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { createWidgetStore } from "./store.mjs";
import { createWidgetHost } from "./host.mjs";
import { createReactWidgetManager } from "./manager-react.mjs";
import { createReactPublications } from "./publications.mjs";
import { disabledRender } from "./disabled-render.mjs";
import { viewLossReason } from "./errors.mjs";
import { createWidgetAPI } from "./api.mjs";
import {createPublicationReceipts} from "./receipts.mjs";
import {runLegacyCleanup} from "./legacy-cleanup.mjs";
import {createWidgetAgentRequests} from "./agent-requests.mjs";
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
  requestQueue,
  messageSerial,
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
  const agentRequests=createWidgetAgentRequests({
    enqueue:(ref,event)=>requestQueue?.enqueue(ref,event)??"full",
    cancelQueued:(ref,requestId)=>requestQueue?.cancel(ref,requestId),
    isCurrent:ref=>Boolean(store.get(ref.widgetId)?.generation===ref.generation),
  });
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
      for(const entry of ['runtime-react.mjs','compiler-runtime.mjs'])await esbuild({
        entryPoints: [fileURLToPath(new URL('./'+entry, import.meta.url))],
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        external: ["esbuild","react","react/jsx-runtime","react-reconciler","react-reconciler/constants.js","scheduler","immer","@tg-assistant/widget","./module-registry.mjs","./react-context.mjs"],
        outfile: path.join(dir, entry),
        banner: {
          js: "import {createRequire as __runtimeRequire} from 'node:module';const require=__runtimeRequire(import.meta.url);",
        },
        logLevel: "silent",
      });
      for (const name of ["jsx-runtime.mjs", "contract.mjs", "module-registry.mjs", "react-context.mjs", "subscriptions.mjs", "sdk.mjs", "types.d.ts"])
        fs.copyFileSync(
          new URL("./" + name, import.meta.url),
          path.join(dir, name),
        );
      const modules = path.join(dir, "node_modules");
      fs.mkdirSync(modules, { recursive: true });
      const esbuildDir = path.dirname(require.resolve("esbuild/package.json"));
      fs.cpSync(esbuildDir, path.join(modules, "esbuild"), { recursive: true });
      for (const dependency of ["react","react-reconciler","scheduler","immer"]) {
        const source=path.dirname(require.resolve(dependency+"/package.json"));
        fs.cpSync(source,path.join(modules,dependency),{recursive:true});
      }
      const runtimeSdk=path.join(modules,"@tg-assistant","widget");
      fs.mkdirSync(runtimeSdk,{recursive:true});
      fs.writeFileSync(path.join(runtimeSdk,"package.json"),JSON.stringify({
        name:"@tg-assistant/widget",type:"module",
        exports:{".":"./sdk.mjs","./jsx-runtime":"./jsx-runtime.mjs"},
      }));
      fs.writeFileSync(path.join(runtimeSdk,"sdk.mjs"),
        'export {defineStore} from "../../../module-registry.mjs";\n'+
        'export {useSelector,useDispatch,useWidget,useView,useViews,useTelegram} from "../../../react-context.mjs";\n'+
        'export {useOnMessage,useOnReply,useOnReaction,useDice} from "../../../subscriptions.mjs";\n');
      fs.writeFileSync(path.join(runtimeSdk,"jsx-runtime.mjs"),
        'export {jsx,jsxs,Fragment} from "react/jsx-runtime";\n');
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
            ".": { types: "./types.d.ts", default: "./sdk.mjs" },
              "./jsx-runtime": {
                types: "./types.d.ts",
                default: "./jsx-runtime.mjs",
              },
            },
          }),
        ),
      );
      for (const name of ["jsx-runtime.mjs", "contract.mjs", "module-registry.mjs", "react-context.mjs", "subscriptions.mjs", "sdk.mjs", "types.d.ts"])
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
  async function launch(owner, { heartbeat },entry='runtime-react.mjs') {
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
          if(entry!=='runtime-react.mjs')throw widgetError('access_denied','Compiler cannot issue widget operations.');
          const ref = args.ref;
          if (
            !ref ||
            ref.botId !== owner.botId ||
            ref.agentId !== owner.agentId
          )
            throw widgetError("access_denied");
          authorize(ref);
          if (method === "api") return api(ref, args.name, args.args);
          if (method === "beginAgentRequest")return agentRequests.begin(ref,args.payload,{timeoutMs:args.timeoutMs,hasSignal:args.hasSignal});
          if (method === "waitAgentRequest")return agentRequests.wait(ref,args.requestId);
          if (method === "cancelAgentRequest")return agentRequests.cancel(ref,args.requestId);
          if (method === "save") {
            validateWidgetState(args.state);
            return store.save(ref, { state: args.state,storeVersion:args.version,revision:args.revision });
          }
          if (method === "publish") {
            return publications.publish(ref,args.viewId,args);
          }
          if (method === "subscription") {
            manager.setSubscription(ref,args.viewId,args.type,args.active);
            return;
          }
          if (method === "detach") return manager.detachRuntimeView(ref,args.viewId);
          if (method === "closeOverlays") return manager.closeOverlays(ref,args.parentViewId);
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
  const publications=createReactPublications({store,telegram,authorize,receipts,filesFor,messageSerial,
    closeOverlays:(ref,parentViewId)=>manager.closeOverlays(ref,parentViewId),
    guest:guest?{publish:async(ref,target,body)=>{
      const scope=authorize(ref),prepared=guest.prepare(scope,body,"widget");
      return guest.publishPrepared(scope,{guestRequestId:target.guestRequestId,prepared});
    },complete:id=>guest.complete(id)}:undefined});
  const build = buildWidget({
    host:{request:(owner,_method,{handler})=>builder.compile(owner,handler)},
    read:(owner,relative)=>filesFor(owner).read(relative),
    persist: async (id, code, o) => {
      const dest = snapshotPath(id, o);
      fs.writeFileSync(dest, code, { mode: 0o600 });
    },
  });
  manager = createReactWidgetManager({
    db,
    host,
    store,
    build,
    publications,
    authorize,
    notify,
    snapshotPath,
    assertInlineOwner:(scope,id)=>{if(!inlineStore)throw widgetError('inline_message_unknown');inlineStore.assertOwner(scope,id);},
    receipts,
    agentRequests,
    invalidateParent:viewId=>publications.invalidateParent(viewId),
    invalidateView:viewId=>publications.invalidateView(viewId),
    disableView:async(ref,view)=>{
      const target=view.target;
      const disable=async()=>{
        if(target.ephemeralMessageId){
          try{await telegram.call(ref.botId,'deleteEphemeralMessage',{
            chat_id:target.chatId,receiver_user_id:target.receiverUserId,
            ephemeral_message_id:target.ephemeralMessageId});}
          catch(error){if(viewLossReason(error)!=='message_not_found')throw error;}
          return;
        }
        const address=target.inlineMessageId?{inline_message_id:target.inlineMessageId}:
          {chat_id:target.chatId,message_id:target.messageId};
        if(view.projection?.body?.rich_message){
          const body=disabledRender(view.projection.body);
          await telegram.call(ref.botId,'editMessageText',{...address,...body,
            reply_markup:{inline_keyboard:[]}});
        }else await telegram.call(ref.botId,'editMessageReplyMarkup',{...address,
          reply_markup:{inline_keyboard:[]}});
      };
      return target.messageId&&messageSerial
        ?messageSerial.run({botId:ref.botId,chatId:target.chatId,messageId:target.messageId},disable)
        :disable();
    },
  });
  const ephemeralTimer=setInterval(()=>void manager.expireEphemeralViews().catch(()=>{}),60_000);
  ephemeralTimer.unref();
  const api = createWidgetAPI({
    authorize,
    manager,
    invoke,
    notify,
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
            .map((w) => w.buildId + ".mjs"),
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
    agentRequests.close();
    clearInterval(ephemeralTimer);
    await builder.close();
    await close();
    closed = true;
    monitor?.close();
    collectSnapshots();
  };
  manager.authorize = authorize;
  manager.answerWidgetRequest=(scope,{requestId,result})=>agentRequests.answer(scope,requestId,result);
  manager.renderer = publications;
  const recover=manager.recover.bind(manager);
  manager.recover=async()=>{
    await runLegacyCleanup({db,
      telegram:{editMessageReplyMarkup:(botId,args)=>telegram.call(botId,"editMessageReplyMarkup",args)},
      authorize:async({botId,agentId,target})=>{
        const agent=db.sql.prepare("SELECT 1 FROM agents WHERE botId=? AND agentId=?").get(botId,agentId);
        return Boolean(db.getBot(botId)&&agent&&
          (target.inlineMessageId||db.getChat(botId,target.chatId)));
      }});
    return recover();
  };
  return manager;
}
