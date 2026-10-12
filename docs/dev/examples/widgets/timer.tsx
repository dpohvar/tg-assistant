import type { WidgetContext } from "@tg-assistant/widget";
export function onInit(ctx: WidgetContext) {
  ctx.state.ticks ??= 0;
  ctx.setInterval(() => ctx.enqueue("tick", Date.now()), 60_000);
}
export function tick(ctx: WidgetContext, event) {
  ctx.state.ticks = Number(ctx.state.ticks) + 1;
  ctx.state.updatedAt = event.data;
}
export function render(state) {
  return {
    text: `Ticks: ${state.ticks}; updated: ${state.updatedAt ?? "not yet"}`,
  };
}
