import { widgetError, validateWidgetState, normalizeWidgetState } from "./contract.mjs";
// Keep handler-held references across intermediate renders whenever mutable.
function reconcileState(current, normalized) {
  if (!current || typeof current !== "object" || !normalized ||
      typeof normalized !== "object" || Array.isArray(current) !== Array.isArray(normalized))
    return normalized;
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(normalized, key) && !Reflect.deleteProperty(current, key))
      return normalized;
  }
  for (const key of Object.keys(normalized)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    const value = reconcileState(descriptor?.value, normalized[key]);
    if (!descriptor) {
      if (!Reflect.defineProperty(current, key, {
        value, enumerable: true, configurable: true, writable: true,
      })) return normalized;
    } else if (!Object.is(descriptor.value, value) &&
        !Reflect.set(current, key, value)) return normalized;
  }
  return current;
}
export function createContext({
  ref,
  state,
  message,
  queueInfo,
  enqueue,
  commit,
  api,
  allowWithoutMessage = false,
}) {
  let stopped = false,
    currentMessage = message,
    committed = normalizeWidgetState(state);
  const abort = new AbortController(),
    resources = [],
    timers = new Set();
  const assert = () => {
    if (stopped) throw widgetError("widget_stopped");
  };
  const ctx = {
    widgetId: ref.widgetId,
    state: structuredClone(committed),
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
      if (!currentMessage && !allowWithoutMessage)
        throw widgetError(
          "message_not_created",
          "Render is unavailable before first publication.",
        );
      const snapshot = normalize();
      await commit(snapshot, {
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
  function normalize() {
    const snapshot = normalizeWidgetState(ctx.state);
    ctx.state = reconcileState(ctx.state, snapshot);
    return snapshot;
  }
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
      return validateWidgetState(normalize()) !== validateWidgetState(committed);
    },
    normalize,
    saved(snapshot = normalize()) {
      committed = normalizeWidgetState(snapshot);
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
