# Programmable Telegram widgets

Widgets are single Telegram messages whose TS/TSX handlers run without a model turn. Buttons, replies, reactions, polls, managed timers and local WebSockets can update saved state and render the same message while its owner agent is busy.

One agent owns each widget, its files and permissions. Publishing in another permitted passive supergroup or channel does not grant the target agent's authority. Private conversations remain isolated. Controller commands take priority over widget replies.

## Create and manage

Write a permanent handler file in the bot wiki, then call:

`handler` is a path to an **existing file**, never inline source code. Save the module with the agent's `exec_command` or `apply_patch` first. Supported extensions are `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` and `.cjs`. Invalid handler arguments and missing files return authoring guidance instead of an ambiguous dependency-resolution error.

```js
await set_widget({handler:"widgets/counter.tsx",description:"Shared counter",state:{count:0}});
```

```tsx
import type {WidgetContext} from '@tg-assistant/widget';
export function render(state) {
  return {text:<b>Count: {state.count}</b>,reply_markup:{inline_keyboard:[
    [{text:'Next',callback_data:'next'}]
  ]}};
}
export function next(ctx:WidgetContext) {ctx.state.count=Number(ctx.state.count)+1;}
```

The trusted SDK is installed automatically on first widget use. JSX uses `@tg-assistant/widget/jsx-runtime`; no React dependency, DOM or hooks are involved. Compilation runs inside the owner's OS sandbox. Static JS/TS/JSON dependencies are bundled into an immutable snapshot; unresolved dynamic packages, native addons and non-code dependency assets produce diagnostics. Read mutable application data explicitly with sandboxed Node APIs. Editing the handler source does not change a running generation.

| Tool | Behavior |
| --- | --- |
| `set_widget` | Create, attach with `messageId`/optional `chatId`, or address an owned registration with `widgetId` |
| `delete_widget` | Remove registration, state and pending events; keep the Telegram message |
| `widgets` | Own metadata, `pending`, `dropped`, and `canCreate` |
| `widget_state` | A copy of the last committed JSON state |
| `widget_event` | Admit a named JSON event and return before processing |
| `render_widget` | Admit a debug render, optionally replacing state, without waiting for publication |

`widgetId` excludes `chatId`, `messageId` and creation options. New/attached/actively replaced handlers require `handler` and nonempty `description`. A disabled resume may omit both. Omitted state preserves saved state; supplied state replaces it. New publication accepts `topicId`, `reply_parameters`, `disable_notification`, `protect_content` and `message_effect_id`. Existing messages reject those creation-only options. Attach requires a known bot-authored message.

## Module exports and context

Export `render(state)` and optional `onInit(ctx)`, `onCreate(ctx)`, `onReply(ctx,event)`, `onReaction(ctx,event)`, `onPoll(ctx,event)`, `onPollAnswer(ctx,event)`, `onStop(ctx)`, `onError(ctx,error,event)`. Button and named external actions are exported functions such as `next(ctx,event)`.

`onInit` runs on startup/restoration with the existing message or null. `onCreate` runs only after first publication, with `ctx.message` present. Each widget generation has separate module globals within one owner runtime. Source changes require explicit replacement.

`ctx` provides mutable `state`, read-only copies of latest-known `message`, `widgetId`, `signal`, `queueInfo`, `api`, `enqueue`, `render`, managed timers, `use(resource,dispose?)` and `defer(dispose)`. The API retains the controller argument shapes for messaging, history, topics, roles, member/profile information, downloads, chats and vault access, plus widget methods, `notify_agent({text})`, `stop_poll({chatId?,messageId?})` and `stop_live_location({chatId?,messageId?})`. Shell, image, MCP, scheduler, Git, browser/PDF and controller WebSocket tools are not exposed inside widgets.

Timers and local sockets should enqueue named actions:

```js
export function onInit(ctx) {
  ctx.setInterval(()=>ctx.enqueue('tick',{now:Date.now()}),60_000);
}
export function tick(ctx,event) {ctx.state.updatedAt=event.data.now;}
```

Local enqueue preserves arbitrary JS references and returns false at capacity. External events use lossless JSON. Per-widget FIFO execution allows long asynchronous handlers; other widgets continue. A synchronous hang stalls the shared event loop and triggers its watchdog. Managed timers stop automatically; disposers run in reverse order even after individual cleanup errors. Native timers/unmanaged resources remain the script's responsibility. Worker threads are forbidden by authoring policy and direct-import diagnostics, not an adversarial OS boundary.

## State, callbacks and observations

Successful handlers save changed state and render automatically. `await ctx.render()` saves before publication and permits intermediate updates. Later errors restore the last committed state. `onError` may recover and return true to suppress ordinary owner notification; unhandled errors notify the owner. External effects are never rolled back or automatically repeated after uncertainty.

Native content and keyboard edits use one request where supported. If Telegram explicitly rejects an edit with `Too Many Requests` and a positive `retry_after`, publication waits that interval and retries after rechecking widget authority. The widget remains active and its event queue waits behind that render. Stopping or replacing it cancels the wait. Initial sends, uncertain transport failures and best-effort button disabling are not retried by this mechanism. Avoid rapid render timers; Telegram may throttle edits even when the model is idle.

`ctx.render()` before first publication returns `message_not_created`: use `render(state)` to describe the initial message, then `onCreate` for effects that need its ID. If Telegram confirmed an initial send but subsequent persistence or media mapping fails, the error includes known `widgetId`, `chatId` and `messageId` where available. Inspect that publication instead of resending. A private recovery receipt helps restore its identity after a controller restart.

Widget callback data supports these forms in both inline keyboards and rich buttons:

| `callback_data` | Behavior |
| --- | --- |
| `void` | The controller immediately acknowledges without text; no handler, widget event, state change or render |
| `next` | Calls the existing `next(ctx,event)` export |
| `cell:0:1` | Calls `cell(ctx,event)`; the full string remains in `event.data.data` |

Only the first colon separates the action from its payload. The payload is an arbitrary string, may be empty and may contain more colons. `event.name` is the action name; `event.data` retains the original Telegram `CallbackQuery`, including its `id`, `from`, `message` and full `data`. The complete callback string must contain 1–64 UTF-8 bytes, not characters. Do not put secrets in callback data.

```js
export function render(state) {
  return {text:`Selected: ${state.selected ?? "none"}`,reply_markup:{inline_keyboard:[[
    {text:"⬜",callback_data:"void"},
    {text:"A1",callback_data:"cell:0:0"},
    {text:"A2",callback_data:"cell:0:1"},
  ]]}};
}
export function cell(ctx,event) {
  const [,row,column] = event.data.data.split(":");
  ctx.state.selected = `${row},${column}`;
}
```

For rich JSX, use the same strings, for example `<tg-button type="callback_data" data="cell:0:1">A2</tg-button>` or `<tg-button type="callback_data" data="void">⬜</tg-button>`. Many decorative buttons can share `void`; many actionable buttons can share one export with different payloads.

The registry stores **complete strings from the current published buttons**, never prefixes or wildcard permissions. Publishing new buttons replaces the registry: a registered `cell:0:1` does not allow `cell:999:999`, and removed buttons no longer dispatch. Checks are scoped to the exact bot, chat and message. System exports and reserved names are forbidden in the action part, including `render:x`, `onInit:x`, `__render:x` and `constructor:x`. Exact `void` is reserved for the controller; `void:anything` is invalid. These forms apply only to widget buttons; named agent/widget/local events keep their existing action semantics.

Widget buttons have no controller permits: handlers should query current `user_roles` where authorization matters. Repeated presses are separate events. Return undefined/null/empty object/string/`{text,showAlert}` or call `await event.respond(answer)` early. The first callback answer wins; no automatic short acknowledgement deadline is imposed.

Reaction and poll projections are updated on intake and refreshed before handlers, including delayed events. `ctx.message.pollAnswers` contains bounded `known` answers, `complete:false` and eviction count; it does not change native poll totals. Preserve Telegram's user/voter-chat identities and persistent option IDs. This is observation data, not a full voter history.

## Rendering and media

Render one send-shaped object: text, rich, photo, video, animation, document, audio, voice, sticker, video note, live photo, location/live location, venue, contact, poll or dice. A live photo uses `{live_photo:{media:'file:motion.mp4',photo:'file:still.jpg'}}`. Albums belong in ordinary `ctx.api.send`, not a widget's own render. Plain text/captions accept strings with parse mode or entities, or JSX compiled to UTF-16 entities. Do not combine formatting representations. A root JSX fragment describes native rich blocks, including details, lists, galleries, files and maps.

Rich JSX supports native HTML-style formatting, `details`/`summary`, lists, figures/captions, tables, reference links, dates, custom emoji and math. Explicit native `rich_message.blocks` objects remain available for fields not represented by aliases. Managed upload caching uses JSX/native block paths; raw `rich_message.html` or Markdown with separate media declarations is not a verified cache-mapping format. Audio, documents and voice notes work in paragraphs, details and lists, but Telegram rejects them in slideshows. Square MP4 video notes must meet Telegram's media requirements; a rectangular file may be returned as a different native type and fail exact cache mapping.

Native creation-only content cannot be changed by rerendering (for example poll/dice/venue/contact). Their keyboards remain editable. Poll closing and live-location stopping use explicit methods. Media/text/rich conversions are passed to Telegram on the same message ID; unsupported edits return errors without delete/resend. Omitted editable caption/keyboard clears it. The [native field inventory](dev/react-message-render-fields.md) and [conversion evidence](dev/widget-type-conversions.md) describe relevant Telegram limits.

Media sources are file IDs, `file:relative/path`, or supported HTTP(S) URLs. Owner file paths reject traversal/symlink escapes. Widget-local RAM cache keys include role, path, mtime and size; changed files upload again. URLs use exact source equality. Returned native IDs are associated by exact media paths; ambiguous rich responses fail instead of guessing. Thumbnails upload fresh. Restart may upload again, so retain durable source files outside `.temp`. Never put secrets in state, media URLs displayed to users, messages or notifications.

## Disabled, deleted and recovery

Disabled widgets retain saved state and external backlog, consume widget slots, ignore callback presses, intercept replies and collect reactions/poll updates. Agent/widget submissions are rejected. Resume with `set_widget`; it preserves disabled backlog. Replacing an active handler clears pending events, revokes the old generation and keeps the message ID. Old effects/commits cannot update its replacement. There is no automatic rollback to a failed old handler.

Events accumulated while disabled retain their original timestamps and are delivered with `delayed:true` on resume. Hooks should decide whether old replies or votes are still relevant.

Disabled debug rendering computes in the sandbox without `onInit`, activation or backlog replay; callbacks stay disabled. Deletion forgets widget state and restores ordinary reply handling, with best-effort button disabling. Deleting the Telegram message removes its registration. Agent context clearing preserves widgets. Stopping an owner disables them; starting the agent does not silently resume them. Agent/bot/chat removal removes affected registrations.

Restart restores previously active widgets with `onInit`; disabled widgets remain disabled. Unstarted durable events become delayed. Callbacks/local RAM events and started events are not replayed; uncertain interrupted effects notify the owner. Widget projections outlive ordinary 30-day history retention. An uncertain initial send retains a disabled registration with unknown message ID; inspect the actual publication before attaching or deleting it.

`onInit` must recreate managed timers or sockets required by restored state; saving `playing:true` does not recreate a game's timer. Unhandled rendering failures retain their error code and description in `disabledReason`, available through `widgets()` and administrator inspection. Owner notifications use the agent's event queue and may be lost if that agent turn fails and clears the queue; inspect retained metadata before attempting recovery.

## Limits and administration

Ten active/disabled registrations per agent; ten owner runtimes per bot; no server-wide cap. One Node event loop per owner. External monitoring sums runtime-tree RSS/working sets, including descendants and sandbox helpers, with a 256 MiB threshold and 500 ms samples. Shared pages may be counted more than once and brief overshoot is possible. Heartbeat is every 5 seconds; 10 seconds of silence stops the owner runtime. Cleanup has a 5-second grace. Failure disables affected widgets, attempts to disable buttons and notifies the owner; no automatic restart.

State: 1 MiB UTF-8 JSON. Waiting events: 1,000 excluding the running event. External event: 64 KiB; pending external payload/control states: 8 MiB. Saved state must be a plain lossless JSON object. Poll answers: 1,000 voters/256 KiB, oldest known answers evicted. Overflow is reported/counted rather than triggering a model for each local event.

Administrators use the [child command reference](commands.md#programmable-widgets), including list, show and deletion. Filters select the owner agent, not the publication chat. Metadata output does not expose state. Windows requires a working strict Codex sandbox (MXC on the tested host); Alpine uses the configured Codex sandbox as a nonroot service user. Unsupported isolation fails closed. Installation and verification are described in [operations](operations.md).

The [implementation verification report](dev/widgets-verification.md) distinguishes automated checks, sandbox tests and live Telegram results. Windows launcher helpers can consume enough conservatively counted working set to exceed the fixed runtime threshold; validate the configured executable on the deployment host rather than raising the limit silently.
