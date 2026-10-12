import { widgetError, validateWidgetState } from "./contract.mjs";
export function createContext({
  ref,
  state,
  message,
  queueInfo,
  enqueue,
  commit,
  api,
}) {
  let stopped = false,
    currentMessage = message,
    committed = structuredClone(state);
  const abort = new AbortController(),
    resources = [],
    timers = new Set();
  const assert = () => {
    if (stopped) throw widgetError("widget_stopped");
  };
  const ctx = {
    widgetId: ref.widgetId,
    state: structuredClone(state),
    get message() {
      return currentMessage ? structuredClone(currentMessage) : null;
    },
    get queueInfo() {
      return queueInfo();
    },
    signal: abort.signal,
    api: new Proxy(
      {},
      {
        get(_, name) {
          return async (args = {}) => {
            assert();
            return api(name, args);
          };
        },
      },
    ),
    enqueue(name, data) {
      assert();
      return enqueue(name, data);
    },
    async render() {
      assert();
      if (!currentMessage)
        throw widgetError(
          "message_not_created",
          "Render is unavailable before first publication.",
        );
      validateWidgetState(ctx.state);
      await commit(ctx.state, {
        saved: (s) => {
          committed = structuredClone(s);
        },
        published: (m) => {
          currentMessage = m;
        },
      });
      assert();
    },
    setTimeout(fn, delay) {
      assert();
      const id = setTimeout(() => {
        timers.delete(id);
        if (!stopped)
          try {
            const p = fn();
            p?.catch?.(() => {});
          } catch {}
      }, delay);
      timers.add(id);
      return id;
    },
    setInterval(fn, delay) {
      assert();
      const id = setInterval(() => {
        if (!stopped)
          try {
            const p = fn();
            p?.catch?.(() => {});
          } catch {}
      }, delay);
      timers.add(id);
      return id;
    },
    clearTimeout(id) {
      clearTimeout(id);
      timers.delete(id);
    },
    clearInterval(id) {
      clearInterval(id);
      timers.delete(id);
    },
    defer(fn) {
      assert();
      if (typeof fn !== "function") throw widgetError("invalid_argument");
      resources.push(fn);
    },
    use(value, dispose) {
      assert();
      const fn = dispose
        ? () => dispose(value)
        : value?.[Symbol.asyncDispose]
          ? () => value[Symbol.asyncDispose]()
          : value?.[Symbol.dispose]
            ? () => value[Symbol.dispose]()
            : value?.dispose
              ? () => value.dispose()
              : value?.close
                ? () => value.close()
                : null;
      if (!fn) throw widgetError("invalid_argument", "Supply a disposer.");
      resources.push(fn);
      return value;
    },
  };
  return {
    ctx,
    assert,
    get stopped() {
      return stopped;
    },
    get committed() {
      return committed;
    },
    changed() {
      return validateWidgetState(ctx.state) !== validateWidgetState(committed);
    },
    saved() {
      committed = structuredClone(ctx.state);
    },
    updateMessage(m) {
      currentMessage = m;
    },
    rollback() {
      ctx.state = structuredClone(committed);
    },
    revoke() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      for (const t of timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      timers.clear();
    },
    async dispose(onStop) {
      this.revoke();
      const errors = [];
      try {
        await onStop?.(ctx);
      } catch (e) {
        errors.push(e);
      }
      for (const dispose of resources.reverse()) {
        try {
          await dispose();
        } catch (e) {
          errors.push(e);
        }
      }
      return errors;
    },
  };
}
