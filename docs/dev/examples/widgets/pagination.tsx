import type { WidgetContext } from "@tg-assistant/widget";
const pages = ["First page", "Second page", "Third page"];
export function onInit(ctx: WidgetContext) {
  ctx.state.page ??= 0;
}
export function render(state) {
  return {
    text: <b>{pages[Number(state.page)]}</b>,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Previous", callback_data: "previous" },
          { text: "Next", callback_data: "next" },
        ],
      ],
    },
  };
}
export function previous(ctx: WidgetContext) {
  ctx.state.page = (Number(ctx.state.page) + pages.length - 1) % pages.length;
}
export function next(ctx: WidgetContext) {
  ctx.state.page = (Number(ctx.state.page) + 1) % pages.length;
}
