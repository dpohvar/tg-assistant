import { widgetError } from "./contract.mjs";
export const WIDGET_API_METHODS = new Set([
  "send",
  "edit",
  "delete",
  "react",
  "copy",
  "forward",
  "pin",
  "unpin",
  "read",
  "history",
  "search",
  "topics",
  "user_roles",
  "members",
  "chat_info",
  "user_photos",
  "download",
  "chats",
  "vault_get",
  "create_widget",
  "update_widget",
  "set_widget_view",
  "delete_widget_view",
  "delete_widget",
  "list_widgets",
  "get_widget",
  "update_widget_store",
  "notify_agent",
  "ws_open",
  "ws_list",
  "ws_pull",
  "ws_send",
  "ws_close",
  "ws_delete",
]);
export function createWidgetAPI({ authorize, invoke, manager, notify }) {
  return async (ref, name, args = {}) => {
    if (!WIDGET_API_METHODS.has(name))
      throw widgetError(
        "access_denied",
        "This controller capability is not available to widgets.",
      );
    const scope = authorize(ref);
    if (name === "create_widget") return manager.create(scope,args,{callerRef:ref});
    if (name === "update_widget") return manager.update(scope,args,{callerRef:ref});
    if (name === "set_widget_view") return manager.setView(scope,args,{callerRef:ref});
    if (name === "delete_widget_view") return manager.deleteView(scope,args,{self:manager.store.getView(args.viewId)?.widgetId===ref.widgetId});
    if (name === "delete_widget")
      return manager.delete(scope, args, {
        self: args.widgetId === ref.widgetId,
      });
    if (name === "list_widgets") return manager.list(scope);
    if (name === "get_widget") return manager.get(scope, args);
    if (name === "update_widget_store") return manager.updateStore(scope,args);
    if (name === "notify_agent") {
      if (typeof args.text !== "string" || args.text.length > 10000)
        throw widgetError("invalid_argument");
      const admitted=await notify(ref, {
        eventType: "widget_message",
        widgetId: ref.widgetId,
        text: args.text,
      });
      if(admitted!=="accepted")throw widgetError("agent_unavailable","Owner queue did not accept the notification.");
      return;
    }
    return invoke(scope, name, args);
  };
}
