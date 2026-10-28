import { randomUUID } from "node:crypto";
import { validateReactState, plainJSON, widgetError } from "./contract.mjs";
import { createReactViews } from "./react-views.mjs";

const id = () => "w" + randomUUID().replaceAll("-", "");
const encode = value => plainJSON(value);

/** Durable React widget records. Runtime hooks and ephemeral renderers stay in memory. */
export function createWidgetStore(db) {
  const sql = db.sql;
  function decode(row) {
    if (!row) return null;
    return { ...row, runtimeProps: JSON.parse(row.runtimeProps), state: JSON.parse(row.state),
      lastError: row.lastError === null ? null : JSON.parse(row.lastError) };
  }
  const get = widgetId => decode(sql.prepare("SELECT * FROM widgets WHERE widgetId=?").get(widgetId));
  function current(ref) {
    const widget = get(ref.widgetId);
    if (!widget || widget.botId !== ref.botId || widget.agentId !== ref.agentId ||
        widget.generation !== ref.generation || widget.lifecycleIntent === "delete")
      throw widgetError("widget_stopped");
    return widget;
  }
  const store = {
    get, current,
    list({botId,agentId}={}) {
      if (!botId) throw widgetError("invalid_argument");
      return sql.prepare(`SELECT * FROM widgets WHERE botId=?${agentId ? " AND agentId=?" : ""} ORDER BY createdAt,widgetId`)
        .all(...(agentId ? [botId,agentId] : [botId])).map(decode);
    },
    create(input) {
      const state = encode(validateReactState(input.state??{}));
      const runtimeProps = encode(input.runtimeProps??{});
      if (!Number.isSafeInteger(input.storeVersion??0) || (input.storeVersion??0)<0)
        throw widgetError("invalid_argument", "Invalid store version.");
      return db.transaction(() => {
        const widgetId = input.widgetId??id();
        sql.prepare(`INSERT INTO widgets(widgetId,botId,agentId,handler,buildId,description,
          runtimeProps,state,storeVersion,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .run(widgetId,input.botId,input.agentId,input.handler,input.buildId??null,input.description,
            runtimeProps,state,input.storeVersion??0,Date.now());
        return get(widgetId);
      });
    },
    save(ref,{state,storeVersion,revision}={}) {
      const normalized = validateReactState(state), json = encode(normalized);
      return db.transaction(() => {
        const widget = current(ref), version = storeVersion??widget.storeVersion;
        if (!Number.isSafeInteger(version) || version<0) throw widgetError("invalid_argument");
        if (revision!==undefined && (!Number.isSafeInteger(revision)||revision<widget.storeRevision))
          throw widgetError("stale_revision");
        if (revision===widget.storeRevision && widget.storeVersion===version && encode(widget.state)!==json)
          throw widgetError("stale_revision","A state change needs a new revision.");
        if (widget.storeVersion === version && encode(widget.state) === json &&
            (revision===undefined || revision===widget.storeRevision)) return widget;
        const nextRevision=revision??widget.storeRevision+1;
        sql.prepare("UPDATE widgets SET state=?,storeVersion=?,storeRevision=? WHERE widgetId=?")
          .run(json,version,nextRevision,widget.widgetId);
        return get(widget.widgetId);
      });
    },
    patch(ref,fields) {
      current(ref);
      const allowed = new Set(["status", "handler", "buildId", "description", "runtimeProps", "lastError", "lifecycleIntent"]);
      const keys = Object.keys(fields);
      if (keys.some(key => !allowed.has(key))) throw widgetError("invalid_argument");
      if (!keys.length) return get(ref.widgetId);
      const values = keys.map(key => fields[key] === null ? null :
        ["runtimeProps", "lastError"].includes(key) ? encode(fields[key]) : fields[key]);
      sql.prepare(`UPDATE widgets SET ${keys.map(key => key+"=?").join(",")} WHERE widgetId=?`)
        .run(...values,ref.widgetId);
      return get(ref.widgetId);
    },
    replace(ref,fields) {
      return db.transaction(() => {
        this.patch(ref,fields);
        sql.prepare("DELETE FROM widget_views WHERE widgetId=? AND targetKind='ephemeral'").run(ref.widgetId);
        sql.prepare("UPDATE widgets SET generation=generation+1 WHERE widgetId=?").run(ref.widgetId);
        return get(ref.widgetId);
      });
    },
    disableOwner({botId,agentId},reason) {
      const detail = typeof reason === "string" ? {code:"owner_disabled",message:reason}
        : {code:reason.code??"runtime_failed",message:String(reason.message),
          ...(reason.diagnosticPath?{diagnosticPath:reason.diagnosticPath}:{})};
      sql.prepare("UPDATE widgets SET status='error',lastError=? WHERE botId=? AND agentId=?")
        .run(encode(detail),botId,agentId);
    },
    deletionIntent(ref) { this.patch(ref,{lifecycleIntent:"delete"}); },
    remove(widgetId) { sql.prepare("DELETE FROM widgets WHERE widgetId=?").run(widgetId); },
    recovery() {
      return db.transaction(() => {
        const unknown = sql.prepare("SELECT * FROM widget_publication_candidates ORDER BY createdAt,viewId").all();
        sql.prepare("DELETE FROM widget_views WHERE targetKind='ephemeral'").run();
        sql.prepare("DELETE FROM widgets WHERE lifecycleIntent='delete'").run();
        return unknown;
      });
    },
  };
  Object.assign(store,createReactViews({db,widgets:store}));
  return store;
}
