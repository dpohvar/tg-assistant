import type { WidgetContext } from "@tg-assistant/widget";
export function render(state) {
  return {
    dice: { emoji: "🎲" },
    reply_markup: {
      inline_keyboard: [
        [{ text: `Rolled: ${state.value ?? "?"}`, callback_data: "explain" }],
      ],
    },
  };
}
export function onCreate(ctx: WidgetContext) {
  ctx.state.value = ctx.message!.dice.value;
}
export function explain(ctx: WidgetContext) {
  return `The dice rolled ${ctx.state.value}.`;
}
