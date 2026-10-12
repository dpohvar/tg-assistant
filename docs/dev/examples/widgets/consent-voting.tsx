import type { WidgetContext, WidgetEvent } from "@tg-assistant/widget";
export function onInit(ctx: WidgetContext) {
  ctx.state.participants ??= {};
}
export function render(state) {
  return {
    text: `Voluntary participants: ${Object.keys(state.participants).length}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Join", callback_data: "join" },
          { text: "Withdraw", callback_data: "withdraw" },
        ],
      ],
    },
  };
}
export function join(ctx: WidgetContext, event: WidgetEvent) {
  const id = event.user?.id;
  if (!Number.isSafeInteger(id))
    return { text: "Press this button yourself.", showAlert: true };
  (ctx.state.participants as Record<string, unknown>)[String(id)] = true;
  return "You joined.";
}
export function withdraw(ctx: WidgetContext, event: WidgetEvent) {
  delete (ctx.state.participants as Record<string, unknown>)[
    String(event.user?.id)
  ];
  return "You withdrew.";
}
