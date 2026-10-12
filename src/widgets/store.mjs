import { randomUUID } from "node:crypto";
import {
  WIDGET_LIMITS as L,
  validateWidgetState,
  validateWidgetEvent,
  widgetError,
} from "./contract.mjs";
export function createWidgetStore(db) {
  const sql = db.sql;
  function decode(row) {
    if (!row) return null;
    const r = { ...row };
    for (const k of ["state", "message", "buttonNames", "renderSpec"])
      r[k] = r[k] === null ? null : JSON.parse(r[k]);
    const q = sql
      .prepare(
        "SELECT count(*) pending,COALESCE(sum(bytes),0) pendingBytes FROM widget_events WHERE widgetId=? AND started=0",
      )
      .get(r.widgetId);
    return { ...r, ...q };
  }
  function get(id) {
    return decode(
      sql.prepare("SELECT * FROM widgets WHERE widgetId=?").get(id),
    );
  }
  function current(ref) {
    const w = get(ref.widgetId);
    if (
      !w ||
      w.botId !== ref.botId ||
      w.agentId !== ref.agentId ||
      w.generation !== ref.generation ||
      w.lifecycleIntent === "delete"
    )
      throw widgetError("widget_stopped");
    return w;
  }
  function admit(
    ref,
    event,
    { controlState, durable = true, control = false } = {},
  ) {
    const json = validateWidgetEvent(event, { control }),
      state =
        controlState === undefined ? null : validateWidgetState(controlState),
      bytes = Buffer.byteLength(json) + (state ? Buffer.byteLength(state) : 0);
    return db.transaction(() => {
      const w = current(ref);
      if (
        w.status === "disabled" &&
        ["agent", "widget", "local", "button"].includes(event.source) &&
        event.name !== "__render"
      )
        throw widgetError("widget_disabled");
      if (w.pending >= L.pending || w.pendingBytes + bytes > L.pendingBytes) {
        sql
          .prepare("UPDATE widgets SET dropped=dropped+1 WHERE widgetId=?")
          .run(w.widgetId);
        return { accepted: false, reason: "queue_full" };
      }
      const seq = w.sequence + 1;
      sql
        .prepare("UPDATE widgets SET sequence=? WHERE widgetId=?")
        .run(seq, w.widgetId);
      sql
        .prepare(
          "INSERT INTO widget_events(widgetId,seq,payload,bytes,durable) VALUES(?,?,?,?,?)",
        )
        .run(w.widgetId, seq, json, bytes, +durable);
      if (event.name === "__render")
        sql
          .prepare("INSERT INTO widget_control_jobs VALUES(?,?,?)")
          .run(w.widgetId, seq, state);
      return { accepted: true, seq };
    });
  }
  return {
    get,
    current,
    list({ botId, agentId } = {}) {
      return sql
        .prepare(
          `SELECT * FROM widgets WHERE botId=?${agentId ? " AND agentId=?" : ""} ORDER BY createdAt,widgetId`,
        )
        .all(...(agentId ? [botId, agentId] : [botId]))
        .map(decode);
    },
    byMessage(botId, chatId, messageId) {
      return decode(
        sql
          .prepare(
            "SELECT * FROM widgets WHERE botId=? AND chatId=? AND messageId=?",
          )
          .get(botId, chatId, messageId),
      );
    },
    byPoll(botId, pollId) {
      return decode(
        sql
          .prepare("SELECT * FROM widgets WHERE botId=? AND pollId=?")
          .get(botId, pollId),
      );
    },
    create(input) {
      const state = validateWidgetState(input.state ?? {});
      return db.transaction(() => {
        if (
          sql
            .prepare("SELECT count(*) n FROM widgets WHERE agentId=?")
            .get(input.agentId).n >= L.widgets
        )
          throw widgetError("widget_quota");
        const id = input.widgetId ?? "w" + randomUUID().replaceAll("-", "");
        sql
          .prepare(
            "INSERT INTO widgets(widgetId,botId,agentId,status,chatId,messageId,topicId,handler,snapshotId,description,state,message,createdAt,lifecycleIntent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            input.botId,
            input.agentId,
            input.status ?? "active",
            input.chatId,
            input.messageId ?? null,
            input.topicId ?? null,
            input.handler,
            input.snapshotId,
            input.description,
            state,
            input.message ? JSON.stringify(input.message) : null,
            Date.now(),
            input.lifecycleIntent ?? null,
          );
        return get(id);
      });
    },
    save(ref, { state, message }) {
      const json = validateWidgetState(state);
      current(ref);
      sql
        .prepare("UPDATE widgets SET state=? WHERE widgetId=?")
        .run(json, ref.widgetId);
      if (message !== undefined) this.patch(ref, { message });
    },
    patch(ref, fields) {
      current(ref);
      const allowed = new Set([
        "status",
        "messageId",
        "topicId",
        "handler",
        "snapshotId",
        "description",
        "message",
        "disabledReason",
        "lifecycleIntent",
        "renderHash",
        "renderSpec",
        "buttonNames",
        "pollId",
      ]);
      if (Object.keys(fields).some((k) => !allowed.has(k)))
        throw widgetError("invalid_argument");
      if (!Object.keys(fields).length) return;
      const keys = Object.keys(fields),
        vals = keys.map((k) =>
          ["message", "renderSpec", "buttonNames"].includes(k) &&
          fields[k] !== null
            ? JSON.stringify(fields[k])
            : fields[k],
        );
      sql
        .prepare(
          `UPDATE widgets SET ${keys.map((k) => `${k}=?`).join(",")} WHERE widgetId=?`,
        )
        .run(...vals, ref.widgetId);
      return get(ref.widgetId);
    },
    replace(ref, fields, { keepPending = false } = {}) {
      return db.transaction(() => {
        current(ref);
        sql
          .prepare(
            "DELETE FROM widget_events WHERE widgetId=?" +
              (keepPending ? " AND (started=1 OR durable=0)" : ""),
          )
          .run(ref.widgetId);
        this.patch(ref, fields);
        if (keepPending)
          sql
            .prepare(
              "UPDATE widget_events SET payload=json_set(payload,'$.delayed',json('true')) WHERE widgetId=?",
            )
            .run(ref.widgetId);
        sql
          .prepare(
            "UPDATE widgets SET generation=generation+1 WHERE widgetId=?",
          )
          .run(ref.widgetId);
        return get(ref.widgetId);
      });
    },
    admit,
    admitRender(ref, state) {
      return admit(
        ref,
        {
          name: "__render",
          source: "agent",
          receivedAt: new Date().toISOString(),
          delayed: false,
          data: {},
        },
        { controlState: state, control: true },
      );
    },
    head(ref, { debugOnly = false } = {}) {
      current(ref);
      const row = sql
        .prepare(
          `SELECT * FROM widget_events WHERE widgetId=? AND started=0 ${debugOnly ? "AND json_extract(payload,'$.name')='__render'" : ""} ORDER BY seq LIMIT 1`,
        )
        .get(ref.widgetId);
      return row ? { ...row, event: JSON.parse(row.payload) } : null;
    },
    begin(ref, seq) {
      current(ref);
      return db.transaction(() => {
        const row = sql
          .prepare(
            "SELECT payload FROM widget_events WHERE widgetId=? AND seq=? AND started=0",
          )
          .get(ref.widgetId, seq);
        if (!row) throw widgetError("widget_stopped", "Event already started.");
        sql
          .prepare(
            "UPDATE widget_events SET started=1 WHERE widgetId=? AND seq=?",
          )
          .run(ref.widgetId, seq);
        const e = JSON.parse(row.payload);
        if (e.name === "__render") {
          const c = sql
            .prepare(
              "SELECT state FROM widget_control_jobs WHERE widgetId=? AND seq=?",
            )
            .get(ref.widgetId, seq);
          e.data = c?.state ? { state: JSON.parse(c.state) } : {};
        }
        return e;
      });
    },
    complete(ref, seq) {
      current(ref);
      sql
        .prepare("DELETE FROM widget_events WHERE widgetId=? AND seq=?")
        .run(ref.widgetId, seq);
    },
    drop(ref, seq) {
      this.complete(ref, seq);
      sql
        .prepare("UPDATE widgets SET dropped=dropped+1 WHERE widgetId=?")
        .run(ref.widgetId);
    },
    disableOwner({ botId, agentId }, reason) {
      sql
        .prepare(
          "UPDATE widgets SET status='disabled',disabledReason=? WHERE botId=? AND agentId=?",
        )
        .run(reason, botId, agentId);
    },
    deletionIntent(ref) {
      current(ref);
      sql
        .prepare("UPDATE widgets SET lifecycleIntent='delete' WHERE widgetId=?")
        .run(ref.widgetId);
    },
    remove(widgetId) {
      sql.prepare("DELETE FROM widgets WHERE widgetId=?").run(widgetId);
    },
    recovery() {
      const uncertain = sql
        .prepare("SELECT DISTINCT widgetId FROM widget_events WHERE started=1")
        .all()
        .map((x) => x.widgetId);
      db.transaction(() => {
        sql.exec(
          "DELETE FROM widgets WHERE lifecycleIntent='delete';DELETE FROM widget_events WHERE started=1 OR durable=0;UPDATE widget_events SET payload=json_set(payload,'$.delayed',json('true'))",
        );
      });
      return uncertain;
    },
  };
}
