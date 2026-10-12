import { randomUUID } from "node:crypto";
import {
  validateSetWidget,
  validateWidgetState,
  assertActionName,
  WIDGET_LIMITS as L,
  publicWidget,
  widgetError,
} from "./contract.mjs";
export function createWidgetManager({
  db,
  host,
  store,
  build,
  render,
  authorize,
  notify = async () => {},
  snapshotPath = (id) => id,
  readReceipt = () => null,
}) {
  const jobs = new Set(),
    locks = new Map(),
    hooks = new Map(),
    origins = new Map(),
    revoked = new Map();
  let closed = false;
  const refKey = (r) => `${r.widgetId}:${r.generation}`;
  const revoke = (r) =>
    revoked.set(
      r.widgetId,
      Math.max(r.generation, revoked.get(r.widgetId) ?? 0),
    );
  const assertOpen = () => {
    if (closed) throw widgetError("widget_stopped");
  };
  const own = (s, id) => {
    const w = store.get(id);
    if (
      !w ||
      w.botId !== s.botId ||
      w.agentId !== s.agentId ||
      w.lifecycleIntent === "delete"
    )
      throw widgetError("widget_not_found");
    return w;
  };
  const track = (p) => {
    jobs.add(p);
    p.finally(() => jobs.delete(p)).catch(() => {});
    return p;
  };
  const locked = async (key, fn, { self = false } = {}) => {
    if (self) return fn();
    const previous = locks.get(key) ?? Promise.resolve();
    const p = previous.catch(() => {}).then(fn);
    locks.set(key, p);
    try {
      return await p;
    } finally {
      if (locks.get(key) === p) locks.delete(key);
    }
  };
  const retained = (o) =>
    store
      .list(o)
      .some(
        (w) =>
          w.status === "active" &&
          w.lifecycleIntent !== "delete" &&
          !manager.isRevoked(w),
      );
  async function release(o) {
    if (!retained(o)) await host.release(o);
  }
  async function retire(w) {
    revoke(w);
    if (!host.has(w)) return;
    let timer;
    try {
      await Promise.race([
        host.request(w, "retire", {}),
        new Promise(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(widgetError("widget_stopped", "Cleanup timed out.")),
              L.teardownMs,
            )),
        ),
      ]);
    } catch (e) {
      await manager.failure(w, e);
    } finally {
      clearTimeout(timer);
    }
  }
  async function load(w, { debug = false } = {}) {
    await host.reserve(w);
    const r = await host.load(w, {
      state: w.state,
      message: w.message,
      snapshotPath: snapshotPath(w.snapshotId, w),
      debug,
    });
    hooks.set(w.widgetId, r?.hooks ?? []);
  }
  async function schedule(w, admit) {
    const id = randomUUID();
    if (w.status === "active") {
      if (!(await host.request(w, "reserveEvent", { id }))) {
        db.sql
          .prepare("UPDATE widgets SET dropped=dropped+1 WHERE widgetId=?")
          .run(w.widgetId);
        throw widgetError("queue_full");
      }
      let result;
      try {
        result = admit();
        if (!result.accepted) throw widgetError(result.reason);
        await host.request(w, "commitEvent", { id, token: result.seq });
      } catch (e) {
        await host.request(w, "cancelEvent", { id }).catch(() => {});
        throw e;
      }
      return result;
    }
    return admit();
  }
  async function restorePending(w) {
    for (let head of db.sql
      .prepare(
        "SELECT seq FROM widget_events WHERE widgetId=? AND started=0 ORDER BY seq",
      )
      .all(w.widgetId)) {
      const id = randomUUID();
      if (!(await host.request(w, "reserveEvent", { id }))) break;
      await host.request(w, "commitEvent", { id, token: head.seq });
    }
  }
  const manager = {
    store,
    host,
    isRevoked: (r) =>
      closed ||
      r.generation <= (revoked.get(r.widgetId) ?? 0) ||
      !store.get(r.widgetId),
    originFor: (r) => origins.get(refKey(r)),
    async set(scope, args, { callerRef } = {}) {
      if (closed) throw widgetError("widget_stopped");
      let existing = args.widgetId
        ? own(scope, args.widgetId)
        : args.messageId
          ? store.byMessage(
              scope.botId,
              args.chatId ?? scope.chatId,
              args.messageId,
            )
          : null;
      if (
        existing &&
        (existing.agentId !== scope.agentId || existing.botId !== scope.botId)
      )
        throw widgetError("widget_not_found");
      validateSetWidget(args, existing);
      const key =
        existing?.widgetId ??
        (args.messageId
          ? `${scope.botId}:${args.chatId ?? scope.chatId}:${args.messageId}`
          : randomUUID());
      const checkCaller = () => {
        if (callerRef && callerRef.widgetId !== existing?.widgetId)
          authorize(callerRef);
      };
      return track(
        locked(
          key,
          async () => {
            assertOpen();
            checkCaller();
            if (existing) existing = own(scope, existing.widgetId);
            validateSetWidget(args, existing);
            let w,
              created = false,
              old = existing;
            if (existing) {
              if (!existing.messageId)
                throw widgetError(
                  "delivery_unknown",
                  "An uncertain publication cannot be resumed; inspect and attach the known message explicitly.",
                );
              authorize({ ...scope, widgetId: null }, existing.chatId);
              revoke(existing);
              await retire(existing);
              assertOpen();
              checkCaller();
              const keepPending = existing.status === "disabled";
              w = store.replace(
                existing,
                {
                  status: "disabled",
                  disabledReason: "Replacing handler",
                  lifecycleIntent: "replacing",
                },
                { keepPending },
              );
              if (args.state !== undefined)
                store.save(w, { state: args.state });
            } else {
              const chatId = args.chatId ?? scope.chatId;
              authorize({ ...scope, widgetId: null }, chatId);
              let message = null;
              if (args.messageId) {
                message = db.getMessage(scope.botId, chatId, args.messageId);
                if (
                  !message ||
                  (message.from?.id !== db.getBot(scope.botId).telegramId &&
                    message.sender_chat?.id !== chatId)
                )
                  throw widgetError(
                    "message_not_found",
                    "Attach requires a known message sent by this bot.",
                  );
              }
              w = store.create({
                ...scope,
                chatId,
                messageId: args.messageId ?? null,
                topicId: args.topicId ?? message?.message_thread_id ?? null,
                handler: args.handler,
                snapshotId: "pending",
                description: args.description,
                state: args.state ?? {},
                message,
                status: "disabled",
                lifecycleIntent: "building",
              });
              created = !args.messageId;
            }
            if (callerRef && callerRef.widgetId !== existing?.widgetId)
              origins.set(refKey(w), callerRef);
            try {
              await host.reserve(w);
              assertOpen();
              checkCaller();
              const built = args.handler
                ? await build(w, args.handler)
                : { snapshotId: w.snapshotId };
              assertOpen();
              checkCaller();
              store.patch(w, {
                handler: args.handler ?? w.handler,
                snapshotId: built.snapshotId,
                description: args.description ?? w.description,
                status: "active",
                disabledReason: null,
                lifecycleIntent: created ? "creating" : null,
              });
              w = store.current(w);
              await load(w);
              checkCaller();
              await restorePending(w);
              await host.request(w, "hook", { name: "onInit" });
              assertOpen();
              checkCaller();
              w = store.current(w);
              const value = await host.request(w, "render", {}),
                envelope = Object.fromEntries(
                  [
                    "reply_parameters",
                    "disable_notification",
                    "protect_content",
                    "message_effect_id",
                  ]
                    .filter((k) => args[k] !== undefined)
                    .map((k) => [k, args[k]]),
                );
              checkCaller();
              await render.publish(w, value, envelope);
              assertOpen();
              checkCaller();
              w = store.current(w);
              if (created) {
                await host.request(w, "hook", {
                  name: "onCreate",
                  message: w.message,
                });
                checkCaller();
                w = store.current(w);
                const after = await host.request(w, "render", {});
                checkCaller();
                await render.publish(w, after);
              }
              checkCaller();
              await host.request(w, "activate", {});
              return {
                widgetId: w.widgetId,
                chatId: w.chatId,
                messageId: w.messageId,
              };
            } catch (e) {
              const current = store.get(w.widgetId);
              if (current?.generation !== w.generation) throw e;
              e.widgetId = w.widgetId;
              if (e.messageId) e.confirmedMessageId = e.messageId;
              if (e.nativeMessage?.message_id)
                try {
                  store.patch(w, {
                    messageId: e.nativeMessage.message_id,
                    message: e.nativeMessage,
                    pollId: e.nativeMessage.poll?.id ?? null,
                  });
                } catch {}
              revoke(w);
              try {
                if (
                  created &&
                  !current.messageId &&
                  !["delivery_unknown", "storage_failed"].includes(e.code)
                ) {
                  store.remove(w.widgetId);
                  render.forget(w.widgetId);
                } else {
                  try {
                    store.patch(w, {
                      status: "disabled",
                      disabledReason: e.code ?? "widget_failed",
                      lifecycleIntent:
                        e.code === "delivery_unknown"
                          ? "delivery_unknown"
                          : null,
                    });
                  } catch {}
                }
              } finally {
                await retire(w);
                await render.disable(w);
                // A failed DB write must not strand a runtime or hide known publication IDs.
                await release(w);
              }
              throw e;
            } finally {
              origins.delete(refKey(w));
              if (!store.get(w.widgetId)) revoked.delete(w.widgetId);
            }
          },
          { self: callerRef?.widgetId === existing?.widgetId },
        ),
      );
    },
    async delete(
      scope,
      { widgetId },
      { self = false, administrative = false } = {},
    ) {
      const w = own(scope, widgetId);
      assertOpen();
      revoke(w);
      store.deletionIntent(w); // Fence effects before acknowledging self-deletion.
      const work = locked(
        widgetId,
        async () => {
          await retire(w);
          await render.disable(w);
          store.remove(widgetId);
          revoked.delete(widgetId);
          render.forget(widgetId);
          hooks.delete(widgetId);
          await release(w);
          if (administrative)
            await notify(w, {
              eventType: "widget_deleted",
              widgetId,
              chatId: w.chatId,
              messageId: w.messageId,
            });
        },
        { self },
      );
      if (self) {
        track(work);
        return;
      }
      return track(work);
    },
    async describe(w) {
      if (w.status !== "active" || !host.has(w)) return w;
      try {
        const q = await host.request(w, "queueInfo", {});
        return q
          ? { ...w, pending: q.pending, dropped: w.dropped + q.dropped }
          : w;
      } catch {
        return store.get(w.widgetId) ?? w;
      }
    },
    async list(scope) {
      const items = await Promise.all(
        store.list(scope).map((w) => manager.describe(w)),
      );
      return {
        canCreate: host.canReserve(scope)
          ? Math.max(0, L.widgets - items.length)
          : 0,
        items: items.map(publicWidget),
      };
    },
    state(scope, { widgetId }) {
      return structuredClone(own(scope, widgetId).state);
    },
    async event(
      scope,
      { widgetId, name, data = null },
      { source = "agent", fromWidgetId } = {},
    ) {
      assertActionName(name);
      assertOpen();
      const w = own(scope, widgetId);
      if (w.status !== "active") throw widgetError("widget_disabled");
      authorize(w, w.chatId);
      const event = {
        name,
        source,
        receivedAt: new Date().toISOString(),
        delayed: false,
        data,
        ...(fromWidgetId ? { fromWidgetId } : {}),
      };
      return track(schedule(w, () => store.admit(w, event)));
    },
    async admit(w, event) {
      assertOpen();
      const current = store.current(w);
      if (current.status === "disabled")
        return store.admit(current, event, {
          durable: event.source !== "button",
        });
      return track(
        schedule(current, () =>
          store.admit(current, event, { durable: event.source !== "button" }),
        ),
      );
    },
    async render(scope, { widgetId, state }) {
      assertOpen();
      if (state !== undefined) validateWidgetState(state);
      const w = own(scope, widgetId);
      if (!w.messageId) throw widgetError("delivery_unknown");
      if (w.status === "active") {
        await track(schedule(w, () => store.admitRender(w, state)));
        return;
      }
      const r = store.admitRender(w, state);
      if (!r.accepted) throw widgetError(r.reason);
      track(
        locked(widgetId, async () => {
          let loaded = false;
          try {
            let current = store.get(widgetId);
            if (
              !current ||
              current.botId !== w.botId ||
              current.agentId !== w.agentId ||
              current.lifecycleIntent === "delete"
            )
              return;
            if (current.status !== "disabled") return;
            current = store.replace(current, {}, { keepPending: true });
            w.generation = current.generation;
            await load(current, { debug: true });
            loaded = true;
            const event = store.begin(current, r.seq);
            if (event.data.state !== undefined)
              store.save(current, { state: event.data.state });
            const value = await host.request(current, "render", {
              state: store.get(widgetId).state,
              debug: true,
            });
            await render.publish(current, value);
            store.complete(current, r.seq);
          } catch (e) {
            await manager.error(w, e);
          } finally {
            if (loaded) await retire(w);
            await release(w);
          }
        }),
      );
    },
    hasHook(w, name) {
      return hooks.get(w.widgetId)?.includes(name) ?? false;
    },
    async error(ref, e) {
      const w = store.get(ref.widgetId);
      if (
        !w ||
        w.generation !== ref.generation ||
        w.lifecycleIntent === "delete"
      )
        return;
      if (
        [
          "render_failed",
          "delivery_unknown",
          "media_mapping_failed",
          "storage_failed",
        ].includes(e.code)
      ) {
        revoke(w);
        store.patch(w, {
          status: "disabled",
          disabledReason: `${e.code}: ${String(e.message).slice(0, 1000)}`,
        });
        await retire(w);
        await render.disable(w);
        await release(w);
      }
      await notify(w, {
        eventType: "widget_error",
        widgetId: w.widgetId,
        chatId: w.chatId,
        messageId: w.messageId,
        error: e.code ?? "widget_failed",
        description: String(e.message).slice(0, 1000),
      });
    },
    async failure(owner, e) {
      const affected = store.list(owner).filter((w) => w.status === "active");
      for (const w of store.list(owner)) revoke(w);
      store.disableOwner(owner, e.code ?? "runtime_failed");
      await host.release(owner);
      await Promise.allSettled(affected.map((w) => render.disable(w)));
      if (affected.length)
        await notify(owner, {
          eventType: "widget_runtime_failed",
          widgets: affected.map(publicWidget),
          error: e.code ?? "runtime_failed",
          description: String(e.message).slice(0, 1000),
        });
    },
    async disableOwner(owner, reason = "agent_disabled") {
      const affected = store.list(owner);
      for (const w of affected) revoke(w);
      store.disableOwner(owner, reason);
      await Promise.allSettled(affected.map((w) => retire(w)));
      await host.release(owner);
      await Promise.allSettled(affected.map((w) => render.disable(w)));
    },
    async removeOwner(owner) {
      for (const w of store.list(owner))
        await manager.delete(owner, { widgetId: w.widgetId });
    },
    async removeChat(botId, chatId) {
      for (const w of store.list({ botId }).filter((w) => w.chatId === chatId))
        await manager.delete(w, { widgetId: w.widgetId });
    },
    async recover() {
      for (const row of db.sql
        .prepare(
          "SELECT widgetId FROM widgets WHERE lifecycleIntent!='delete' OR lifecycleIntent IS NULL",
        )
        .all()) {
        const w = store.get(row.widgetId),
          receipt =
            !w.messageId || w.lifecycleIntent === "creating"
              ? readReceipt(w)
              : null;
        if (receipt) store.patch(w, receipt);
      }
      for (const id of store.recovery()) {
        const w = store.get(id);
        if (w)
          await notify(w, {
            eventType: "widget_error",
            widgetId: id,
            error: "interrupted_effect",
            description:
              "In-flight work was interrupted and will not be retried automatically.",
          });
      }
      for (const row of db.sql
        .prepare(
          "SELECT widgetId FROM widgets WHERE lifecycleIntent IS NOT NULL",
        )
        .all()) {
        const w = store.get(row.widgetId);
        store.patch(w, {
          status: "disabled",
          disabledReason: "interrupted_creation",
          lifecycleIntent: w.messageId ? null : "delivery_unknown",
        });
      }
      for (const candidate of db.sql
        .prepare("SELECT * FROM widgets WHERE status='active'")
        .all()
        .map((x) => store.get(x.widgetId))) {
        const w = store.get(candidate.widgetId);
        if (!w || w.status !== "active" || manager.isRevoked(w)) continue;
        try {
          authorize(w, w.chatId);
          await load(w);
          await restorePending(w);
          await host.request(w, "hook", { name: "onInit" });
          await host.request(w, "activate", {});
        } catch (e) {
          await manager.failure(w, e);
        }
      }
    },
    async idle() {
      while (jobs.size) await Promise.allSettled([...jobs]);
    },
    async close() {
      closed = true;
      await Promise.allSettled(
        db.sql
          .prepare("SELECT * FROM widgets WHERE status='active'")
          .all()
          .map((w) => retire(store.get(w.widgetId))),
      );
      await host.close();
      await manager.idle();
    },
  };
  return manager;
}
