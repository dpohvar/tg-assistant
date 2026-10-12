import { WIDGET_LIMITS as L, widgetError } from "./contract.mjs";
export function createWidgetHost({
  launch,
  measureTree,
  terminateTree = async (s) => s.kill?.(),
  clock = Date.now,
  onFailure = async () => {},
}) {
  const sessions = new Map();
  let closed = false,
    sampling = false;
  const key = (o) => `${o.botId}:${o.agentId}`;
  const host = {
    measureTree,
    has(o) {
      return sessions.has(key(o));
    },
    canReserve(o) {
      return (
        !closed &&
        (sessions.has(key(o)) ||
          [...sessions.values()].filter((s) => s.owner.botId === o.botId)
            .length < L.processes)
      );
    },
    async reserve(owner) {
      if (closed) throw widgetError("widget_stopped");
      const k = key(owner);
      if (sessions.has(k)) return sessions.get(k).ready;
      if (!host.canReserve(owner)) throw widgetError("runtime_quota");
      const s = { owner, heartbeat: clock(), failed: false, child: null };
      sessions.set(k, s);
      s.ready = (async () => {
        try {
          s.child = await launch(owner, {
            heartbeat: () => host.heartbeat(owner),
            failure: (e) => host.fail(s, e),
          });
          s.heartbeat = clock();
          if (s.child.on) {
            s.child.on("exit", () => {
              if (sessions.get(k) === s)
                void host.fail(
                  s,
                  widgetError("widget_stopped", "Runtime exited."),
                );
            });
          }
          await s.child.ready;
          if (closed || sessions.get(k) !== s)
            throw widgetError("widget_stopped");
          return s;
        } catch (e) {
          if (sessions.get(k) === s) await host.fail(s, e);
          throw widgetError(e.code ?? "sandbox_unavailable", e.message);
        }
      })();
      return s.ready;
    },
    heartbeat(o) {
      const s = sessions.get(key(o));
      if (s) s.heartbeat = clock();
    },
    async request(ref, method, args) {
      const s = await host.reserve(ref);
      return s.child.request(method, { ...args, ref });
    },
    async load(ref, snapshot) {
      return host.request(ref, "load", snapshot);
    },
    async fail(s, e) {
      if (s.failed) return;
      s.failed = true;
      try {
        if (s.child) await terminateTree(s.child.identity ?? s.child);
      } finally {
        await s.child?.close?.();
        if (sessions.get(key(s.owner)) === s) sessions.delete(key(s.owner));
        await onFailure(s.owner, e);
      }
    },
    async release(o) {
      const s = sessions.get(key(o));
      if (!s) return;
      sessions.delete(key(o));
      s.failed = true;
      try {
        await s.ready;
      } catch {}
      try {
        if (s.child) await terminateTree(s.child.identity ?? s.child);
      } finally {
        await s.child?.close?.();
      }
    },
    async sample() {
      if (sampling || closed) return;
      sampling = true;
      try {
        for (const s of [...sessions.values()]) {
          if (!s.child || s.failed) continue;
          try {
            if (clock() - s.heartbeat > L.silenceMs)
              throw widgetError("widget_stopped", "Heartbeat expired.");
            const m = await host.measureTree(s.child.identity ?? s.child);
            if (!Number.isFinite(m.bytes) || m.bytes > L.memory)
              throw widgetError(
                "widget_stopped",
                "Runtime memory limit exceeded.",
              );
          } catch (e) {
            await host.fail(s, e);
          }
        }
      } finally {
        sampling = false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await Promise.allSettled(
        [...sessions.values()].map((s) => host.release(s.owner)),
      );
    },
  };
  const timer = setInterval(() => {
    void host.sample();
  }, L.sampleMs);
  timer.unref();
  return host;
}
