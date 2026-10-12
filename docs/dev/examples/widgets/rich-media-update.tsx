import type { WidgetContext } from "@tg-assistant/widget";
export function render(state) {
  return (
    <>
      <h2>Gallery</h2>
      <details>
        <summary>Open gallery</summary>
        <ul>
          <li>
            {typeof state.src === "string" ? (
              <img src={state.src} />
            ) : (
              <p>No image yet.</p>
            )}
          </li>
        </ul>
      </details>
      <buttons>
        <button callback_data="refresh">Refresh</button>
      </buttons>
    </>
  );
}
export function update(ctx: WidgetContext, event) {
  if (typeof event.data?.src !== "string")
    throw new Error('Pass {src:"file:path/to/image.jpg"}.');
  ctx.state.src = event.data.src;
}
export function refresh(ctx: WidgetContext) {
  ctx.state.revision = Number(ctx.state.revision ?? 0) + 1;
}
