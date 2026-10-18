import type { WidgetContext } from "@tg-assistant/widget";
export function render(state) {
  return {
    dice: { emoji: "🎲" },
    reply_markup: {
      inline_keyboard: [
        [{ text: "Show this roll", callback_data: "explain" }],
      ],
    },
  };
}
export async function explain(ctx: WidgetContext, event) {
  const view=await ctx.api.get_widget({widgetId:ctx.widgetId});
  const message=view.views.find(item=>item.id===event.view.id)?.message;
  return `This view rolled ${message?.dice?.value ?? 'an unknown value'}.`;
}
export function onCreate(ctx: WidgetContext) {ctx.state.created=true;}
