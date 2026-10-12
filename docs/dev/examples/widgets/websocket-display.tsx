import type { WidgetContext } from "@tg-assistant/widget";
let socket: WebSocket | undefined;
export function onInit(ctx: WidgetContext) {
  ctx.state.last ??= "Waiting";
  if (typeof ctx.state.url !== "string") return;
  socket = ctx.use(new WebSocket(ctx.state.url));
  socket.addEventListener("message", (event) =>
    ctx.enqueue("update", String(event.data)),
  );
  socket.addEventListener("error", () =>
    ctx.enqueue("update", "Connection failed"),
  );
}
export function update(ctx: WidgetContext, event) {
  ctx.state.last = String(event.data).slice(0, 2000);
}
export function ping() {
  if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  return "Ping requested.";
}
export function render(state) {
  return {
    text: String(state.last),
    reply_markup: {
      inline_keyboard: [[{ text: "Ping", callback_data: "ping" }]],
    },
  };
}
