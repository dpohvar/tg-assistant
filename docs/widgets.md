# Programmable Telegram widgets

A widget owns shared JSON state, one event queue and managed timers, and renders into zero or more Telegram messages. Each message is a **view**. Views can be in different permitted chats or use opaque inline message IDs; all share the same game or application state. Losing the last view does not stop timers or delete the widget.

One agent owns each widget. Publication in a passive supergroup/channel uses that agent's existing permissions. Another agent cannot take over an occupied message: `view_conflict` identifies `ownerAgentId`, `widgetId` and `viewId`. A rejected conflicting attachment does not block the existing view's buttons.

## Create and manage

Write a permanent handler file in the bot workspace first. `handler` is an existing `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` path, never inline source code.

```js
const {widgetId} = await create_widget({
  handler:"widgets/counter.tsx", description:"Shared counter", state:{count:0}
});
await set_widget_view({widgetId, send:{}, props:{part:"game"}});
await set_widget_view({widgetId, send:{chatId:-1001234567890}, props:{part:"results"}});
```

```tsx
import type {WidgetContext, WidgetView} from '@tg-assistant/widget';
export function render(state, view:WidgetView) {
  const text = `Count: ${state.count}`;
  if (view.props.part === 'results') return {text};
  return {text, reply_markup:{inline_keyboard:[[{text:'Next',callback_data:'next'}]]}};
}
export function next(ctx:WidgetContext) {ctx.state.count++;}
```

The trusted JSX SDK is installed automatically. There is no React dependency, DOM or React hooks. Compilation runs in a separate temporary owner sandbox; static code/JSON dependencies become an immutable snapshot. The compiler terminates after each build; the widget runtime does not load esbuild. Builds serialize per owner. A failed build leaves existing widget execution intact. Editing source files does not change a running generation. Read mutable assets explicitly using sandboxed Node APIs.

| Tool | Behavior |
| --- | --- |
| `create_widget` | Create with required `handler`/`description`, optional `state`; returns `{widgetId}` with no views |
| `update_widget` | Required `widgetId`; optional `handler`, `state`, `description`; preserves views and rerenders all |
| `set_widget_view` | Required `widgetId`, exactly one `send` or `target`, optional object `props`; returns `{viewId,target}` |
| `delete_widget_view` | Required `viewId`; detach and best-effort disable all normal/rich buttons, keeping the message |
| `delete_widget` | Remove registration/state/queue; leave all messages with buttons disabled best effort |
| `list_widgets` | `{canCreate,items}`: own metadata with `viewCount` and `hasError`; reads do not run handlers |
| `get_widget` | Required `widgetId`; committed state, views, errors and `possiblePublications` |
| `widget_event` | Required `widgetId`/`name`, optional JSON `data`; returns after admission, before execution |

Description is required only at creation. Omitted replacement fields preserve old values. Handler/state updates validate/build first, retire the old generation, initialize the new one, keep pending admissible events and repaint all views. An active empty or description-only update repaints without lifecycle hooks. Any update to a stopped widget attempts initialization and recovery. There are no public stop, resume or render tools.

## Message addresses and replacement

To publish an owned widget as the direct answer to a [guest invocation](guest-mode.md#widgets-and-callbacks), use `set_widget_view({widgetId,send:{guestRequestId},props:{}})`. The first visible message is the prepared render. Its initial frozen target is `{guestRequestId}` until Telegram returns the real inline ID; later views/events use `{inlineMessageId}`. Each successful publication creates an independent view, even if Telegram accepted multiple answers for the same request. Local uploads and unsupported initial native result formats are rejected before publication.

`send:{}` publishes in the agent's current chat. Creation options are `chatId`, `topicId`, `reply_parameters`, `disable_notification`, `protect_content` and `message_effect_id`.

```js
await set_widget_view({widgetId, send:{disable_notification:true}});
await set_widget_view({widgetId, target:{messageId:123}, props:{part:"results"}});
await set_widget_view({widgetId, target:{chatId:-1001234567890,messageId:123}});
await set_widget_view({widgetId, target:{inlineMessageId:"OPAQUE_ID"}});
```

An ordinary attachment needs a known bot-authored message without `via_bot`, or an existing owned view. Inline attachment needs established inline ownership; the originating callback can establish it. Do not derive chat/message IDs by decoding an inline ID. Address forms exclude each other; no `kind` field is needed.

Attaching to an existing owned view replaces it with a new `viewId` and new props. The controller waits for the running handler and publication. It commits the new binding only after confirmed Telegram publication; any failure keeps the old binding. Unknown delivery is an error and marks uncertainty. Newly arriving old-view callbacks are rejected as soon as replacement is admitted.

The `view` passed to `render(state,view)` contains only `{id,target,props}` as a recursively frozen snapshot. Before a new send, `target` contains `chatId` without an invented message ID. Old `render(state)` functions ignore the extra argument and continue working. There is no primary message; deprecated `ctx.message` must not be used to choose a view.

## Module exports and context

Required: `render(state,view)`. Optional hooks: `onInit(ctx)`, `onCreate(ctx)`, `onReply(ctx,event)`, `onReaction(ctx,event)`, `onPoll(ctx,event)`, `onPollAnswer(ctx,event)`, `onViewDelete(ctx,event)`, `onStop(ctx)` and `onError(ctx,error,event)`.

`onInit` runs on creation, restoration and handler/state replacement. `onCreate` runs once when the registration is first created, before any view exists. A failing `onInit` stops the widget immediately and returns `widget_init_failed` with `widgetId`, `phase:"onInit"`, `status:"stopped"` and `causeCode`. Valid partial state already saved by initialization is retained; there is no rollback to the old handler.

`ctx` provides mutable `state`, `widgetId`, `signal`, `queueInfo`, `api`, `enqueue`, `render`, managed timeout/interval methods, `use(resource,dispose?)` and `defer(dispose)`. Each generation has separate module globals. Approved messaging/read/profile/vault and widget methods are available through `ctx.api`, plus `notify_agent({text})`. Shell, image, MCP, scheduler, Git, browser/PDF and controller WebSocket tools are excluded.

Native stop operations require an explicit owned view: `ctx.api.stop_poll({viewId})` or `ctx.api.stop_live_location({viewId})`. Explicit full addresses are also accepted. Poll stopping requires ordinary chat/message IDs; inline live locations are supported. There is no implicit current-message fallback.

Timers and sockets should enqueue serial actions:

```js
export function onInit(ctx) {
  ctx.setInterval(()=>ctx.enqueue('tick',{now:Date.now()}),60_000);
}
export function tick(ctx,event) {ctx.state.updatedAt=event.data.now;}
```

Timers keep working with zero views. Managed resources dispose in reverse order, including after individual cleanup errors. Native unmanaged resources remain the handler's responsibility. Worker threads are prohibited by authoring policy and import diagnostics, not an adversarial code boundary.

## State, callbacks and observations

Successful handlers save changed state before rendering each view. `await ctx.render()` commits intermediate state and rerenders all views, including when there are none. A failed view does not undo saved state or prevent other views rendering. Later handler errors restore the last committed state. State serialization omits undefined object fields and converts undefined array elements/holes to null; other unsupported non-JSON values remain invalid.

Widget callback strings are exact current published values, 1–64 UTF-8 bytes:

| String | Behavior |
| --- | --- |
| `void` | Empty acknowledgement, no queue/state/render |
| `next` | Calls exported `next(ctx,event)` |
| `cell:0:1` | Calls exported `cell`; full string remains in `event.data.data` |

Only the first colon separates action/payload. System hooks, `constructor`, `__` names and `void:payload` are forbidden button actions. Prefixes/wildcards do not authorize unregistered values. Rich buttons use the same strings, for example `<tg-button type="callback_data" data="cell:0:1">A2</tg-button>`.

`event.data` keeps the native CallbackQuery. `event.view` records the source view snapshot. Inline callbacks have an inline ID and no invented ordinary message. Return a string, `{text,showAlert}`, null/undefined, or call `await event.respond(answer)`; the first answer wins. Widget buttons have no ordinary one-use groups or permits: check current `user_roles` in handlers when needed.

Events wait during rendering. Before dispatch, a button must still match the same view ID and exact published callback string; otherwise it is acknowledged without text and ignored. Continuous replacement invalidates button events, but retains replies/reactions against the same message with their original source snapshot. Detach/rebind ends that continuity. Poll events also require the same poll ID. Stop deletes queued work; it is never replayed after recovery.

Reactions and poll projections update per addressed view on intake. They are observations, not a full voter history. Unknown inline destinations do not expose chat history, replies or reactions through their inline ID. Controller commands take priority over replies.

## Rendering, media and failures

Each render returns one native send-shaped object: text, rich, photo, video, animation, document, audio, voice, sticker, video note, live photo, location, venue, contact, poll or dice. Albums belong to ordinary `ctx.api.send`. JSX text/captions produce UTF-16 entities; do not combine competing formatting forms. A root JSX fragment describes rich blocks. Consult `rich_help` for current native structures.

Ordinary view media accept reusable file IDs, `file:relative/path` and supported public HTTP(S) URLs. Local uploads are cached by role/path/mtime/size; URLs by exact source. Returned file IDs map through exact native paths. Thumbnails upload fresh. Inline editing forbids uploads: use existing IDs/public URLs. Retain durable source assets outside `.temp`. Secret-bearing Telegram URLs, traversal and symlinks are rejected. Native content conversions are attempted in place; unsupported conversions never cause automatic delete/resend. Creation-only poll/dice/venue/contact content can change its keyboard, not its original payload.

Confirmed edit throttling with a positive `retry_after` waits and rechecks authority before retrying. Initial sends and uncertain transport outcomes are not automatically repeated. A new first-send uncertainty creates a separate `possiblePublications` diagnostic, not a view. It contains a candidate `viewId`, chat ID and a message ID if Telegram confirmed one. Private per-view receipts preserve publication gaps across restart; recovery records uncertainty without overwriting newer observations or replaying sends. Inspect/reattach the actual message, then explicitly clear the candidate using `delete_widget_view`.

Unhandled errors latch the latest error on the affected view or widget. `onError` runs once per error; returning true handles it. An error inside `onError` is retained as a secondary diagnostic without recursion. Only the first unhandled error in an empty latch notifies the owner; repeated timer/button failures update the latch silently. Reads, background successes and description-only updates do not clear it. Successful agent repair clears the relevant latch before fresh failures. Direct tool failures are returned to the caller without a duplicate model event.

Confirmed deletion or loss of access detaches only that view and optionally queues `onViewDelete(ctx,{view,reason,...})`. Other render errors keep the view. Telegram may reveal deletion only when a later edit fails; there is no general bot deletion notification.

## Stopped, deleted and recovery

`active` and `stopped` are the only statuses. Stopped is an emergency state: no events are admitted, queued events are discarded, managed execution stops and all normal/rich buttons are disabled best effort. `update_widget` attempts recovery; starting the owner agent alone does not resume widgets. Deletion leaves messages inactive and forgets the widget. Detaching the last view leaves shared state and timers running.

Normal controller restart restores active registrations with `onInit`; stopped ones remain stopped. Unstarted durable replies/reactions/polls/external events can resume with `delayed:true`; in-flight work, buttons and local RAM events are not replayed. `onInit` must reconstruct managed timers/sockets from saved state. Model context resets preserve widget identity/state/views. Owner deletion removes registrations; removing a publication chat detaches its views.

## Limits and administration

Ten registrations per agent, including stopped/zero-view; ten owner processes per bot, no server-wide cap. One resident Node event loop per owner; a synchronous hang affects all its widgets. Temporary compiler processes have independent monitored trees and the same resource limits; compilation can temporarily add memory/processes beyond the resident runtime quota. The controller monitors the runtime tree (256 MiB, 500 ms samples), heartbeat every 5 s with 10 s silence, and a 5 s teardown limit. A common runtime/watchdog failure stops all owner widgets, purges queues, kills that process tree and emits one aggregate event.

External queue limits: 1,000 pending events, 64 KiB/event, 8 MiB pending bytes. State limit: 1 MiB. RPC frames: 2 MiB. Local enqueue preserves arbitrary references and returns false at capacity.

Administrators use [widget commands](commands.md#programmable-widgets). Lists show owner, pending count, view count and addresses. Private views never have links; group/channel addresses become links only when enough metadata exists. Inline IDs stay opaque. `show` includes errors/candidates but excludes state.

Executable examples are under [development examples](dev/examples/widgets/): [pagination](dev/examples/widgets/pagination.tsx), [voting](dev/examples/widgets/consent-voting.tsx), [timer](dev/examples/widgets/timer.tsx), [WebSocket](dev/examples/widgets/websocket-display.tsx), [dice](dev/examples/widgets/dice-onCreate.tsx), [rich media](dev/examples/widgets/rich-media-update.tsx), [live location](dev/examples/widgets/live-location.tsx) and [error recovery](dev/examples/widgets/error-repair.tsx). See [verification](dev/inline-widget-verification.md) for automated and live evidence.
