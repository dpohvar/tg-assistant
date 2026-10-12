import type { WidgetContext } from "@tg-assistant/widget";
export function render(state) {
  return {
    text: state.lastError ? `Handled: ${state.lastError}` : "Ready",
    reply_markup: {
      inline_keyboard: [[{ text: "Test error", callback_data: "fail" }]],
    },
  };
}
export function fail() {
  throw new Error("Demonstration failure");
}
export function onError(ctx: WidgetContext, error, event) {
  ctx.state.lastError = String(error.message);
  return true;
}
