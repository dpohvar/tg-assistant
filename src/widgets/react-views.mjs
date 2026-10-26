import { randomUUID } from "node:crypto";
import { plainJSON, widgetError } from "./contract.mjs";

const id = prefix => prefix + randomUUID().replaceAll("-", "");
const parse = value => value === null ? null : JSON.parse(value);

export function confirmedTarget(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw widgetError("invalid_argument");
  const keys = Object.keys(value).sort().join(",");
  if (keys === "inlineMessageId" && typeof value.inlineMessageId === "string" && value.inlineMessageId)
    return { inlineMessageId: value.inlineMessageId };
  if (keys === "chatId,messageId" && Number.isSafeInteger(value.chatId) && value.chatId !== 0 &&
      Number.isSafeInteger(value.messageId) && value.messageId > 0)
    return { chatId: value.chatId, messageId: value.messageId };
  if (keys === "chatId,ephemeralMessageId,receiverUserId" && Number.isSafeInteger(value.chatId) &&
      value.chatId !== 0 && Number.isSafeInteger(value.receiverUserId) && value.receiverUserId > 0 &&
      Number.isSafeInteger(value.ephemeralMessageId) && value.ephemeralMessageId > 0)
    return { chatId: value.chatId, receiverUserId: value.receiverUserId,
      ephemeralMessageId: value.ephemeralMessageId };
  throw widgetError("invalid_argument", "One confirmed ordinary, inline, or ephemeral address is required.");
}

export function createReactViews({ db, widgets }) {
  const sql = db.sql;
  const writable = new Set(["status", "lastError", "message", "projection", "projectionHash",
    "deliveryUnknown", "activeAt", "props", "exportName", "rendererKey", "bindingEpoch"]);
  const jsonColumns = new Set(["lastError", "message", "projection", "props"]);
  function decode(row) {
    if (!row) return null;
    const target = row.targetKind === "inline" ? { inlineMessageId: row.inlineMessageId }
      : row.targetKind === "ephemeral" ? { chatId: row.chatId, receiverUserId: row.receiverUserId,
        ephemeralMessageId: row.ephemeralMessageId }
      : { chatId: row.chatId, messageId: row.messageId };
    return { ...row, id: row.viewId, target, props: parse(row.props), message: parse(row.message),
      projection: parse(row.projection), lastError: parse(row.lastError),
      deliveryUnknown: Boolean(row.deliveryUnknown) };
  }
  const getView = viewId => decode(sql.prepare("SELECT * FROM widget_views WHERE viewId=?").get(viewId));
  function owned(ref,viewId) {
    widgets.current(ref);
    const view = getView(viewId);
    if (!view || view.widgetId !== ref.widgetId) throw widgetError("view_not_found");
    return view;
  }
  function byTarget(botId,input) {
    const target = confirmedTarget(input);
    return decode(target.inlineMessageId
      ? sql.prepare("SELECT * FROM widget_views WHERE botId=? AND inlineMessageId=?").get(botId,target.inlineMessageId)
      : target.ephemeralMessageId
        ? sql.prepare("SELECT * FROM widget_views WHERE botId=? AND chatId=? AND receiverUserId=? AND ephemeralMessageId=?")
          .get(botId,target.chatId,target.receiverUserId,target.ephemeralMessageId)
        : sql.prepare("SELECT * FROM widget_views WHERE botId=? AND chatId=? AND messageId=?")
          .get(botId,target.chatId,target.messageId));
  }
  function createView(ref,input) {
    const widget = widgets.current(ref), target = confirmedTarget(input.target);
    const kind = target.inlineMessageId ? "inline" : target.ephemeralMessageId ? "ephemeral" : "message";
    if (byTarget(widget.botId,target)) throw widgetError("view_conflict");
    if (kind !== "ephemeral" &&
        (typeof input.exportName !== "string" || !/^[A-Za-z_$][\w$]*$/.test(input.exportName)))
      throw widgetError("invalid_argument", "Durable view requires an exported component.");
    if (input.parentViewId) {
      const parent = owned(ref,input.parentViewId);
      if (kind !== "ephemeral" || parent.targetKind === "ephemeral") throw widgetError("invalid_argument");
    }
    const viewId = input.id ?? id("v"), now = Date.now();
    sql.prepare(`INSERT INTO widget_views(
      viewId,widgetId,botId,agentId,parentViewId,receiverUserId,targetKind,
      chatId,messageId,inlineMessageId,ephemeralMessageId,chatType,topicId,exportName,
      props,rendererKey,status,lastError,message,projection,projectionHash,bindingEpoch,
      deliveryUnknown,createdAt,activeAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      viewId,widget.widgetId,widget.botId,widget.agentId,input.parentViewId??null,
      target.receiverUserId??null,kind,target.chatId??null,target.messageId??null,
      target.inlineMessageId??null,target.ephemeralMessageId??null,input.chatType??null,input.topicId??null,
      input.exportName??null,kind === "ephemeral" ? null : plainJSON(input.props??{}),
      input.rendererKey??null,input.status??"active",input.lastError?plainJSON(input.lastError):null,
      input.message?plainJSON(input.message):null,input.projection?plainJSON(input.projection):null,
      input.projectionHash??null,input.bindingEpoch??id("e"),Number(Boolean(input.deliveryUnknown)),now,now);
    return getView(viewId);
  }
  return {
    getView, byTarget, createView,
    listViews(widgetId) { return sql.prepare("SELECT * FROM widget_views WHERE widgetId=? ORDER BY createdAt,viewId").all(widgetId).map(decode); },
    patchView(ref,viewId,fields) {
      owned(ref,viewId);
      const keys = Object.keys(fields);
      if (keys.some(key => !writable.has(key))) throw widgetError("invalid_argument");
      if (!keys.length) return getView(viewId);
      sql.prepare(`UPDATE widget_views SET ${keys.map(key => key+"=?").join(",")} WHERE viewId=?`)
        .run(...keys.map(key => fields[key] === null ? null : jsonColumns.has(key) ? plainJSON(fields[key])
          : key === "deliveryUnknown" ? Number(Boolean(fields[key])) : fields[key]),viewId);
      return getView(viewId);
    },
    detachView(ref,viewId) {
      const view = owned(ref,viewId);
      sql.prepare("DELETE FROM widget_views WHERE viewId=?").run(viewId);
      return view;
    },
    byMessage(botId,chatId,messageId) {
      const view = byTarget(botId,{chatId,messageId});
      return view ? { ...widgets.get(view.widgetId), view } : null;
    },
    addCandidate(ref,{viewId=id("v"),target,reason="delivery_unknown"}) {
      const widget = widgets.current(ref);
      sql.prepare("INSERT INTO widget_publication_candidates(viewId,widgetId,botId,agentId,target,createdAt,reason) VALUES(?,?,?,?,?,?,?)")
        .run(viewId,widget.widgetId,widget.botId,widget.agentId,plainJSON(target),Date.now(),reason);
      return viewId;
    },
    listCandidates(widgetId) {
      return sql.prepare("SELECT * FROM widget_publication_candidates WHERE widgetId=? ORDER BY createdAt,viewId")
        .all(widgetId).map(row => ({ ...row,target:JSON.parse(row.target) }));
    },
    getCandidate(viewId) {
      const row = sql.prepare("SELECT * FROM widget_publication_candidates WHERE viewId=?").get(viewId);
      return row ? { ...row,target:JSON.parse(row.target) } : null;
    },
    removeCandidate(ref,viewId) {
      widgets.current(ref);
      sql.prepare("DELETE FROM widget_publication_candidates WHERE widgetId=? AND viewId=?").run(ref.widgetId,viewId);
    },
  };
}
