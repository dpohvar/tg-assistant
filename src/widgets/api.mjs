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
  "set_widget",
  "delete_widget",
  "widgets",
  "widget_state",
  "widget_event",
  "render_widget",
  "notify_agent",
  "stop_poll",
  "stop_live_location",
]);
export function createWidgetAPI({ authorize, invoke, manager, notify, stop }) {
  return async (ref, name, args = {}) => {
    if (!WIDGET_API_METHODS.has(name))
      throw widgetError(
        "access_denied",
        "This controller capability is not available to widgets.",
      );
    const scope = authorize(ref);
    if (name === "set_widget")
      return manager.set(scope, args, { callerRef: ref });
    if (name === "delete_widget")
      return manager.delete(scope, args, {
        self: args.widgetId === ref.widgetId,
      });
    if (name === "widgets") return manager.list(scope);
    if (name === "widget_state") return manager.state(scope, args);
    if (name === "widget_event") {
      await manager.event(scope, args, {
        source: "widget",
        fromWidgetId: ref.widgetId,
      });
      return;
    }
    if (name === "render_widget") {
      await manager.render(scope, args);
      return;
    }
    if (name === "notify_agent") {
      if (typeof args.text !== "string" || args.text.length > 10000)
        throw widgetError("invalid_argument");
      await notify(ref, {
        eventType: "widget_message",
        widgetId: ref.widgetId,
        text: args.text,
      });
      return;
    }
    if (name === "stop_poll" || name === "stop_live_location")
      return stop(ref, name, args);
    return invoke(scope, name, args);
  };
}
