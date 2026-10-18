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
import {deepFreeze, viewSnapshot} from './views.mjs';
const hookNames = {
  reply: "onReply",
  reaction: "onReaction",
  poll: "onPoll",
  poll_answer: "onPollAnswer",
  view_delete: "onViewDelete",
};
export function createRuntime({ bridge }) {
  const widgets = new Map();
  function current(ref) {
    const w = widgets.get(ref.widgetId);
    if (!w || w.ref.generation !== ref.generation || w.context.stopped)
      throw widgetError("widget_stopped");
    return w;
  }
  async function rendered(w, state, view) {
    try {
      const value = normalizeRender(
        await w.module.render(normalizeWidgetState(state), view ? deepFreeze(viewSnapshot(view)) : undefined),
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
    const legacyValue = !w.viewMode ? await rendered(w,state) : undefined;
    w.context.assert();
    await bridge("save", { ref: w.ref, state });
    saved?.(state);
    w.context.assert();
    if (w.initializing) return;
    if (!w.viewMode) {
      w.context.assert();
      const message = await bridge('publish',{ref:w.ref,value:legacyValue});
      published?.(message);
      return;
    }
    for (const view of await bridge('views',{ref:w.ref})) {
      try {
        const value = await rendered(w,state,view);
        w.context.assert();
        await bridge('publish',{ref:w.ref,viewId:view.id,value});
      } catch(error) {
        await reportError(w,{...error,code:error.code??'render_failed',message:String(error.message),operation:'render',view:viewSnapshot(view)},w.currentEvent,view.id);
      }
    }
  }
  async function reportError(w,error,event,viewId,{quiet=false}={}) {
    let handled=false;
    const original={...error,code:error.code??'widget_failed',message:String(error.message).slice(0,1000)};
    if (!w.reporting && typeof w.module.onError==='function') {
      w.reporting=true;
      try {
        handled=await w.module.onError(w.context.ctx,original,event)===true;
        if(w.context.changed())await w.context.ctx.render();
      } catch(recoveryError) {error={...original,secondaryError:{code:recoveryError.code??'widget_failed',message:String(recoveryError.message).slice(0,1000)}};handled=false;w.context.rollback();}
      finally {w.reporting=false;}
    }
    if(!handled)await bridge('notifyError',{ref:w.ref,viewId,quiet,error:{...original,...(error.secondaryError?{secondaryError:error.secondaryError}:{})}});
  }
  async function action(w, event) {
    w.context.assert();
    w.currentEvent=event;
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
      await reportError(w,e,event);
    } finally {
      if(event.source==='button'&&!answer&&!w.context.stopped)await event.respond();
      w.currentEvent=undefined;
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
      { state = {}, message = null, module: mod, snapshotPath, debug = false, viewMode = false },
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
        viewMode,
        commitJob:Promise.resolve(),
        renderWaiters:[],
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
        commit: async (s, callbacks) => {
          if(w.reporting)return commit(w,s,callbacks);
          if(w.paused&&!w.running&&!w.initializing&&!w.reporting)
            await new Promise(resolve=>w.renderWaiters.push(resolve));
          w.context.assert();
          const job=w.commitJob.catch(()=>{}).then(()=>commit(w,s,callbacks));
          w.commitJob=job;
          return job;
        },
        api: (name, args) => bridge("api", { ref, name, args }),
        allowWithoutMessage:viewMode,
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
        if(name==='onInit'&&!w.context.stopped&&w.context.changed()) {
          const snapshot=w.context.normalize();
          await bridge('save',{ref,state:snapshot});w.context.saved(snapshot);
        }
      }
    },
    async render(ref, { state, message, view, debug = false } = {}) {
      const w = current(ref);
      if (state !== undefined) w.context.ctx.state = normalizeWidgetState(state);
      if (message !== undefined) w.context.updateMessage(message);
      return rendered(w, w.context.normalize(), view);
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
      for(const resolve of w.renderWaiters.splice(0))resolve();
      pump(w);
    },
    async pause(ref) {
      const w=current(ref);w.paused=true;
      await w.job;
      await w.commitJob.catch(()=>{});
    },
    async handleError(ref,{error,event,viewId,quiet}) {
      await reportError(current(ref),error,event,viewId,{quiet});
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
    async retire(ref,{self=false}={}) {
      const w = widgets.get(ref.widgetId);
      if (!w || w.ref.generation !== ref.generation) return;
      w.context.revoke();
      w.queue.clear();
      for (const r of w.reservations.values()) r.release();
      widgets.delete(ref.widgetId);
      for(const resolve of w.renderWaiters.splice(0))resolve();
      if(!self)await w.job;
      if(!self)await w.commitJob.catch(()=>{});
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
        "pause",
        "handleError",
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
