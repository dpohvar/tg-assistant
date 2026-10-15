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
import { createWidgetTransport } from "./transport.mjs";
import { createProcessMonitor } from "./monitor.mjs";
import { launchSandbox } from "./sandbox.mjs";
import { buildWidget } from "./build.mjs";
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
      await esbuild({
        entryPoints: [fileURLToPath(new URL("./runtime.mjs", import.meta.url))],
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        external: ["esbuild"],
        outfile: path.join(dir, "runtime.mjs"),
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
  const host = createWidgetHost({
    launch: async (owner, { heartbeat }) => {
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
          if (method === "publish") return renderer.publish(ref, args.value);
          if (method === "begin") {
            const event = store.begin(ref, args.token);
            const w = store.get(ref.widgetId);
            return { event, message: w.message, dropped: w.dropped };
          }
          if (method === "complete") {
            store.complete(ref, args.token);
            return;
          }
          if (method === "drop") {
            if (args.event?.token) store.drop(ref, args.event.token);
            return;
          }
          if (method === "notifyError") {
            await manager.error(ref, args.error);
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
        });
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
    },
    measureTree: (id) => monitor.measureTree(id),
    terminateTree: (id) => monitor.terminateTree(id),
    onFailure: (o, e) => manager.failure(o, e),
  });
  const renderer = createWidgetRenderer({
    store,
    db,
    telegram,
    filesFor,
    authorize,
    journal: (ref, message, projection) => {
      const dir = path.join(assets(ref), "receipts");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, ref.widgetId + ".json"),
        JSON.stringify({ generation: ref.generation, message, projection }),
        { mode: 0o600 },
      );
    },
  });
  const build = buildWidget({
    host,
    persist: async (id, code, o) => {
      const dest = snapshotPath(id, o);
      fs.writeFileSync(dest, code, { mode: 0o600 });
    },
  });
  manager = createWidgetManager({
    db,
    host,
    store,
    build,
    render: renderer,
    authorize,
    notify,
    snapshotPath,
    readReceipt: (w) => {
      try {
        const receipt = JSON.parse(
          fs.readFileSync(
            path.join(assets(w), "receipts", w.widgetId + ".json"),
            "utf8",
          ),
        );
        if (
          receipt.generation !== w.generation ||
          receipt.message?.chat?.id !== w.chatId ||
          !Number.isSafeInteger(receipt.message?.message_id)
        )
          return null;
        return {
          ...receipt.projection,
          message: receipt.message,
          messageId: receipt.message.message_id,
          pollId: receipt.message.poll?.id ?? null,
        };
      } catch {
        return null;
      }
    },
  });
  const api = createWidgetAPI({
    authorize,
    manager,
    invoke,
    notify,
    stop: async (ref, name, args) => {
      const w = store.current(ref),
        chatId = args.chatId ?? w.chatId,
        messageId = args.messageId ?? w.messageId;
      authorize(ref, chatId);
      const m = await telegram.call(
        ref.botId,
        name === "stop_poll" ? "stopPoll" : "stopMessageLiveLocation",
        { chat_id: chatId, message_id: messageId },
      );
      if (messageId === w.messageId && chatId === w.chatId) {
        const latest = store.current(ref).message;
        const message =
          name === "stop_poll"
            ? { ...latest, poll: m }
            : {
                ...m,
                ...Object.fromEntries(
                  ["reactions", "pollAnswers"]
                    .filter((k) => latest?.[k] !== undefined)
                    .map((k) => [k, latest[k]]),
                ),
              };
        store.patch(ref, {
          message,
        });
      }
      return m;
    },
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
  const close = manager.close;
  manager.close = async () => {
    await close();
    closed = true;
    monitor?.close();
    collectSnapshots();
  };
  manager.authorize = authorize;
  manager.renderer = renderer;
  return manager;
}
