import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createContext } from "./context.mjs";
import { createLocalQueue } from "./queue.mjs";
import { normalizeRender } from "./jsx-runtime.mjs";
import {
  assertActionName,
  widgetCallbackAction,
  normalizeWidgetState,
  widgetError,
  WIDGET_LIMITS as L,
} from "./contract.mjs";
import { connectWidgetTransport } from "./transport.mjs";
import { compileWidget } from "./build.mjs";
const hookNames = {
  reply: "onReply",
  reaction: "onReaction",
  poll: "onPoll",
  poll_answer: "onPollAnswer",
};
export function createRuntime({ bridge }) {
  const widgets = new Map();
  function current(ref) {
    const w = widgets.get(ref.widgetId);
    if (!w || w.ref.generation !== ref.generation || w.context.stopped)
      throw widgetError("widget_stopped");
    return w;
  }
  async function rendered(w, state) {
    try {
      const value = normalizeRender(
        await w.module.render(normalizeWidgetState(state)),
      );
      const visit = (v) => {
        if (!v || typeof v !== "object") return;
        if (typeof v.callback_data === "string") {
          const name = widgetCallbackAction(v.callback_data);
          if (name !== null && typeof w.module[name] !== "function")
            throw widgetError("invalid_argument", `No exported action ${name}.`);
        }
        for (const x of Object.values(v)) visit(x);
      };
      visit(value);
      return value;
    } catch (e) {
      throw widgetError("render_failed", String(e.message));
    }
  }
  async function commit(w, state, { saved, published } = {}) {
    w.context.assert();
    state = normalizeWidgetState(state);
    const value = await rendered(w, state);
    w.context.assert();
    await bridge("save", { ref: w.ref, state });
    saved?.(state);
    w.context.assert();
    if (w.initializing) return;
    try {
      const message = await bridge("publish", { ref: w.ref, value });
      published?.(message);
    } catch (e) {
      if (
        ![
          "storage_failed",
          "delivery_unknown",
          "media_mapping_failed",
        ].includes(e.code)
      )
        e.code = "render_failed";
      throw e;
    }
  }
  async function action(w, event) {
    w.context.assert();
    let answer = false;
    if (event.source === "button")
      event.respond = async (value) => {
        w.context.assert();
        if (answer) return;
        answer = true;
        await bridge("respond", {
          ref: w.ref,
          callbackId: event.data.id,
          answer: value ?? null,
        });
      };
    try {
      if (event.message !== undefined) w.context.updateMessage(event.message);
      const name = hookNames[event.source] ?? event.name,
        fn = w.module[name];
      if (typeof fn !== "function") {
        if (event.source === "local") return;
        await bridge("drop", { ref: w.ref, event });
        return;
      }
      const result = await fn(w.context.ctx, event);
      if (w.context.stopped) return;
      if (event.source === "button") await event.respond(result);
      if (w.context.changed()) await w.context.ctx.render();
    } catch (e) {
      if (w.context.stopped) return;
      w.context.rollback();
      let handled = false;
      try {
        if (typeof w.module.onError === "function")
          handled =
            (await w.module.onError(
              w.context.ctx,
              {
                message: String(e.message).slice(0, 1000),
                code: e.code ?? "widget_failed",
              },
              event,
            )) === true;
        if (w.context.changed()) await w.context.ctx.render();
      } catch (recoveryError) {
        handled = false;
        e = recoveryError;
        w.context.rollback();
      }
      if (!handled)
        await bridge("notifyError", {
          ref: w.ref,
          error: {
            message: String(e.message).slice(0, 1000),
            code: e.code ?? "widget_failed",
          },
        });
    }
  }
  function pump(w) {
    if (w.paused || w.running || w.context.stopped) return;
    const next = w.queue.take();
    if (!next) return;
    w.running = true;
    w.job = (async () => {
      try {
        if (next.gate) await next.gate;
        if (w.context.stopped) return;
        let event = next.event ?? {
          name: next.name,
          source: "local",
          data: next.data,
          receivedAt: new Date().toISOString(),
          delayed: false,
        };
        if (next.token) {
          const data = await bridge("begin", { ref: w.ref, token: next.token });
          w.externalDropped = data.dropped ?? 0;
          event = { ...data.event, message: data.message, token: next.token };
        }
        if (event.name === "__render") {
          if (event.data?.state !== undefined)
            w.context.ctx.state = normalizeWidgetState(event.data.state);
          await w.context.ctx.render();
        } else await action(w, event);
        if (next.token && !w.context.stopped)
          await bridge("complete", { ref: w.ref, token: next.token });
        next.resolve?.();
      } catch (e) {
        next.reject?.(e);
        if (!w.context.stopped)
          await bridge("notifyError", {
            ref: w.ref,
            error: {
              code: e.code ?? "widget_failed",
              message: String(e.message).slice(0, 1000),
            },
          }).catch(() => {});
      } finally {
        w.running = false;
        w.reservations.delete(next.id);
        pump(w);
      }
    })();
  }
  const runtime = {
    async load(
      ref,
      { state = {}, message = null, module: mod, snapshotPath, debug = false },
    ) {
      if (widgets.has(ref.widgetId))
        await runtime.retire(widgets.get(ref.widgetId).ref);
      mod ??= await import(
        pathToFileURL(snapshotPath).href +
          `?widget=${encodeURIComponent(ref.widgetId)}&generation=${ref.generation}`
      );
      if (typeof mod.render !== "function")
        throw widgetError("invalid_argument", "Export render(state).");
      const w = {
        ref,
        module: mod,
        queue: createLocalQueue(),
        reservations: new Map(),
        running: false,
        dropped: 0,
        initializing: false,
        debug,
        paused: !!snapshotPath,
      };
      w.context = createContext({
        ref,
        state,
        message,
        queueInfo: () => ({
          pending: w.queue.pending,
          dropped: w.dropped + (w.externalDropped ?? 0),
        }),
        enqueue(name, data) {
          assertActionName(name);
          if (!w.queue.enqueue(name, data)) {
            w.dropped++;
            return false;
          }
          queueMicrotask(() => pump(w));
          return true;
        },
        commit: (s, callbacks) => commit(w, s, callbacks),
        api: (name, args) => bridge("api", { ref, name, args }),
      });
      widgets.set(ref.widgetId, w);
      return {
        hooks: Object.keys(mod).filter((k) => typeof mod[k] === "function"),
      };
    },
    async hook(ref, name, { message } = {}) {
      const w = current(ref);
      if (message !== undefined) w.context.updateMessage(message);
      if (name === "onInit") w.initializing = true;
      try {
        if (typeof w.module[name] === "function")
          await w.module[name](w.context.ctx);
        if (w.context.stopped) return;
        if (w.context.changed()) {
          const snapshot = w.context.normalize();
          await bridge("save", { ref, state: snapshot });
          w.context.saved(snapshot);
        }
      } finally {
        w.initializing = false;
      }
    },
    async render(ref, { state, message, debug = false } = {}) {
      const w = current(ref);
      if (state !== undefined) w.context.ctx.state = normalizeWidgetState(state);
      if (message !== undefined) w.context.updateMessage(message);
      return rendered(w, w.context.normalize());
    },
    async dispatch(ref, event) {
      const w = current(ref);
      return new Promise((resolve, reject) => {
        if (
          !w.queue.enqueue(event.name, event.data, { event, resolve, reject })
        )
          return reject(widgetError("queue_full"));
        pump(w);
      });
    },
    activate(ref) {
      const w = current(ref);
      w.paused = false;
      pump(w);
    },
    queueInfo(ref) {
      const w = current(ref);
      return { pending: w.queue.pending, dropped: w.dropped };
    },
    reserveEvent(ref, { id }) {
      const w = current(ref);
      let release;
      const item = { id, gate: new Promise((r) => (release = r)) };
      if (!w.queue.enqueue("__external", null, item)) return false;
      w.reservations.set(id, { item, release });
      return true;
    },
    commitEvent(ref, { id, token }) {
      const w = current(ref),
        r = w.reservations.get(id);
      if (!r) throw widgetError("widget_stopped");
      r.item.token = token;
      r.release();
      pump(w);
    },
    cancelEvent(ref, { id }) {
      const w = current(ref),
        r = w.reservations.get(id);
      if (r) {
        r.item.event = { name: "__cancel", source: "local" };
        r.release();
        pump(w);
      }
    },
    async retire(ref) {
      const w = widgets.get(ref.widgetId);
      if (!w || w.ref.generation !== ref.generation) return;
      w.context.revoke();
      w.queue.clear();
      for (const r of w.reservations.values()) r.release();
      widgets.delete(ref.widgetId);
      return w.context.dispose(w.debug ? undefined : w.module.onStop);
    },
    async close() {
      await Promise.allSettled(
        [...widgets.values()].map((w) => runtime.retire(w.ref)),
      );
    },
  };
  return runtime;
}
async function main() {
  let line = "";
  for await (const chunk of process.stdin) {
    line += chunk;
    if (line.includes("\n")) break;
  }
  const boot = JSON.parse(line),
    assets = path.dirname(new URL(import.meta.url).pathname);
  let rpc;
  const runtime = createRuntime({ bridge: (m, a) => rpc.request(m, a) });
  rpc = await connectWidgetTransport({
    ...boot,
    handle: async (method, args) => {
      if (method === "build")
        return compileWidget(args.handler, {
          cwd: process.cwd(),
          agentId: boot.owner.agentId,
          assets: boot.assets,
        });
      const allowed = [
        "load",
        "hook",
        "render",
        "dispatch",
        "reserveEvent",
        "commitEvent",
        "cancelEvent",
        "retire",
        "activate",
        "queueInfo",
      ];
      if (!allowed.includes(method)) throw widgetError("invalid_argument");
      const { ref, ...rest } = args;
      return method === "hook"
        ? runtime.hook(ref, rest.name, rest)
        : method === "dispatch"
          ? runtime.dispatch(ref, rest.event)
          : runtime[method](ref, rest);
    },
  });
  const heart = setInterval(() => {
    void rpc.request("heartbeat", {}).catch(() => process.exit(1));
  }, L.heartbeatMs);
  process.on("SIGTERM", () => {
    clearInterval(heart);
    void runtime.close().finally(() => process.exit());
  });
}
if (process.argv.includes("--widget-runtime"))
  main().catch(() => {
    console.error("widget_runtime_failed");
    process.exit(1);
  });
