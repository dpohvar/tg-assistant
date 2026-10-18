import type { WidgetContext } from "@tg-assistant/widget";
export function onInit(ctx: WidgetContext) {
  ctx.state.latitude ??= 35.1856;
  ctx.state.longitude ??= 33.3823;
}
export function render(state) {
  return {
    location: {
      latitude: Number(state.latitude),
      longitude: Number(state.longitude),
      live_period: 86400,
    },
    reply_markup: {
      inline_keyboard: [[{ text: "Stop tracking", callback_data: "stop" }]],
    },
  };
}
export function move(ctx: WidgetContext, event) {
  if (
    !Number.isFinite(event.data?.latitude) ||
    !Number.isFinite(event.data?.longitude)
  )
    throw new Error("Pass numeric latitude/longitude.");
  ctx.state.latitude = event.data.latitude;
  ctx.state.longitude = event.data.longitude;
}
export async function stop(ctx: WidgetContext, event) {
  await ctx.api.stop_live_location({viewId:event.view.id});
  return "Live location stopped. Further edits require a new message.";
}
