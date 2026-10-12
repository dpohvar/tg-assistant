# Programmable Telegram widgets

Status: agreed design implemented on the widget feature branch. This document preserves the consolidated design; current behavior is described in the [widget wiki](../widgets.md), with results and remaining acceptance checks in the [verification report](widgets-verification.md). Native type conversions are permitted and their verified matrix is documented separately.

The [discussion protocol](react-messages-discussion.md) preserves the design history. Later decisions supersede earlier proposals, particularly the names `react`/`send_widget`, stopped-record semantics, and awaited forced rendering. Current implemented behavior remains documented in the [project wiki](../index.md).

## Purpose and ownership

An agent writes a TypeScript/TSX module to operate an interactive Telegram message without invoking the model on each event. Examples include roulette, voting, pagination, live-location updates, and WebSocket-driven displays. Handlers continue working while the model is busy.

Each widget has one owner agent and one Telegram message. The owner supplies its sandbox, files, permissions and notification destination, even when the message is published in another permitted chat. Permission checks run again before controller effects. Publication does not grant the widget another agent's authority.

Authoring should require one handler file, without manual build setup or callback registration. Provide a typed SDK, concise examples, build diagnostics and structural validation. JSX is a convenient way to author native Telegram text/rich content; React hooks and a browser DOM are not part of this contract. Exact SDK package/import names remain an implementation detail.

## Runtime and quotas

| Resource | Agreed policy |
| --- | --- |
| Registered widgets | At most 10 per agent, active and disabled combined |
| Widget runtimes | At most 10 per bot; one shared Node process/event loop per owner agent |
| Worker threads | Forbidden as an authoring rule, with direct-import diagnostics; not an adversarial OS boundary |
| Memory | External monitor, 256 MiB for a runtime and its descendants, sampled every 500 ms |
| Heartbeat | Every 5 seconds; stop the runtime after 10 seconds of silence |
| Teardown | 5-second total grace period, then terminate the shared runtime if necessary |
| Saved state | JSON, at most 1 MiB serialized UTF-8 |
| Pending events | At most 1,000 per widget, excluding the running event |
| External event | At most 64 KiB serialized UTF-8 JSON |
| External queue | At most 8 MiB of JSON payload per widget; database overhead is additional |

There is no server-wide widget cap. Ordinary agent processes are not widget-runtime slots. Disabled registrations consume widget slots but need no permanently running handler process. `canCreate` reflects both remaining widget slots and whether the owner can obtain a runtime slot.

Controller-owned foreground runtimes run inside the owner's proven Codex/OS sandbox. An unrestricted Node fallback, `cwd`, or Node `vm` alone is insufficient. Fail closed if a supported sandbox cannot be started. Filter runtime environment variables; do not inherit controller credentials indiscriminately.

Compile handler code and dependencies into an immutable generation snapshot. Source-file edits do not alter a live generation. Agent build plugins and package lifecycle scripts must not execute with controller privileges. Native Node filesystem/network/package access stays inside the sandbox.

The shared loop deliberately trades fault isolation for memory savings. A synchronous hang, process crash or memory violation disables all active widgets of that owner, terminates descendants, attempts to disable keyboards, and notifies the owner with affected widget/message IDs. Retain the last committed state. Do not automatically restart a failed runtime.

Memory monitoring is external, includes Buffer allocations and descendant processes, and allows brief overshoot. Do not spawn PowerShell every sample. The precise platform metric and accounting for sandbox helpers require a documented implementation decision and verification. Normal asynchronous handlers have no general wall-clock deadline; heartbeat health is distinct from completion of a pending Promise.

## Registration states

| Status | Processing | Saved data and routing |
| --- | --- | --- |
| `active` | Handlers, timers and subscriptions operate | State, metadata and durable pending events retained |
| `disabled` | No live handlers, timers or sockets; callbacks ignored | State and external backlog retained; replies do not trigger the model |
| Deleted | No widget registration | State and queue removed; Telegram message remains ordinary |

Deleted is a lifecycle outcome, not a permanently retained list item. Active and disabled items both occupy widget quota. No manual disable/stop method is exposed. Unhandled render failures disable the affected widget; shared-runtime failures disable all affected active widgets.

Disabled callbacks receive an empty acknowledgement when possible and are not queued. Replies and reactions accumulate under the agreed queue limits. Agent/other-widget submissions to disabled widgets fail rather than accumulating. Controller commands always take priority over reply interception, including syntax and authorization errors.

Stopping an owner agent disables its widgets while retaining state/backlog. Deleting an owner agent deletes its widget registrations but preserves their published messages. Explicit controller deletion of a widget's Telegram message also deletes its registration. External message deletion may only be detected later by a failed operation. Agent context clearing does not itself remove widget registrations.

Removing a widget disables its buttons best effort and restores ordinary reply routing. Failure to edit a keyboard never keeps an inactive handler callable. Already completed external effects are not rolled back.

## Agent tools and ctx.api

These six operations have identical argument, permission and result semantics in agent tools and `ctx.api`:

| Operation | Contract |
| --- | --- |
| `set_widget` | Create, attach to a message, replace an active handler, or resume a disabled widget |
| `delete_widget` | Remove registration, state and backlog; preserve the Telegram message |
| `widgets` | List owned active/disabled widgets and `canCreate`; expose no other-agent runtime counts |
| `widget_state` | Read a copy of the last committed state |
| `widget_event` | Submit a named external event; return after admission, not after handler completion |
| `render_widget` | Submit a debug render, optionally replacing state; return after admission |

The consolidated input shape for `set_widget` is:

```ts
set_widget({
  widgetId?, messageId?, chatId?,
  handler?, description?, state?,
  topicId?, reply_parameters?, disable_notification?,
  protect_content?, message_effect_id?
});
```

`widgetId` identifies an existing owned registration; `messageId` with its chat addresses a message for attachment/management; no target means create a new Telegram message. Reject ambiguous selectors. `chatId` defaults by the existing owner-agent controller convention, not implicitly to another widget's publication chat. Final schema names and returned ID object will be frozen in the implementation plan.

New/attached widgets require a handler and a nonempty description. Active replacement also requires a description. A simple disabled resume may omit handler/description and reuse the saved generation. Supplying a new handler is a replacement requiring a description. Description is durable operational metadata, not message content.

Explicit `state` replaces the whole state. New state defaults to `{}`; omission for an existing registration reuses its last committed state. Creation-only Telegram options are rejected for attachment, replacement or resume instead of silently ignored. Add `message_effect_id` to ordinary `send` as well, with native restrictions.

Active replacement stops the old generation, clears its pending events, disposes its resources, and installs the new generation on the same message. Buttons may remain visible during transition but must not dispatch into the old generation. No automatic rollback to the old handler if the replacement fails. Disabled resume, including repair with a new handler, preserves its durable backlog.

`widgets()` exposes IDs, description, status, publication chat/message/topic, disable reason and queue counters. It contains one capacity field, `canCreate`, without redundant used/remaining fields or bot-wide process counts. Queue counter field names are to be consistent with `ctx.queueInfo`.

`widget_event({widgetId,name,data?})` returns after acceptance, with explicit failures for disabled/not-found/full/oversized targets. Caller data cannot forge source, sender identity or timestamps.

`render_widget({widgetId,state?})` is fire-and-forget after admission. A queued render uses supplied replacement state or the current saved state at execution time. It does not bypass the running handler. Unlike `ctx.render()`, it does not await publication, including when invoked from the same widget.

Debug rendering also supports disabled widgets: compute and publish in the owner's sandbox without `onInit`, activation, timer restoration or backlog replay. Keep callbacks disabled and status unchanged. Errors notify the owner asynchronously. Debug execution observes runtime/memory quotas and watchdogs. A deleted/not-found target or unknown message ID cannot cause a new send.

The implementation plan schedules disabled debug control jobs separately from paused external backlog, while sharing admission budgets. Active debug jobs follow ordinary FIFO; disabled debugging does not resume or consume pending external events.

## Module, context and resources

The module exports `render(state)` and optional lifecycle/event functions:

```ts
export function render(state) { /* return one message representation */ }
export function onInit(ctx) {}
export function onCreate(ctx) {}
export function onReply(ctx, event) {}
export function onReaction(ctx, event) {}
export function onPoll(ctx, event) {}
export function onPollAnswer(ctx, event) {}
export function onStop(ctx) {}
export function onError(ctx, error, event) {}
export async function vote(ctx, event) { /* named action */ }
```

Handlers may perform expensive asynchronous filesystem/network operations. Each widget has its own module-generation instance despite the shared event loop. Render describes content, not side effects. Provide `ctx.widgetId`, mutable working `ctx.state`, latest-known read-only `ctx.message`, `ctx.api`, `ctx.signal`, queue information, `ctx.enqueue` and awaited `ctx.render()`.

Managed resources belong to a widget generation, not to one callback invocation:

```ts
ctx.setTimeout(callback, delay);
ctx.setInterval(callback, delay);
ctx.clearTimeout(handle);
ctx.clearInterval(handle);
ctx.use(resource);       // Symbol.asyncDispose or Symbol.dispose
ctx.defer(cleanup);      // synchronous or asynchronous cleanup
```

Stop rejects new events/effects/resources, cancels managed timers and aborts the signal. Finish the current handler where applicable, invoke `onStop`, and dispose resources in reverse order, continuing cleanup after individual errors. The whole teardown has the shared five-second grace period. Native timers and unmanaged sockets are the script's responsibility.

Timer/WebSocket callbacks should use `ctx.enqueue(name,data)`. Direct mutation/render outside the queue is technically possible; the author accepts the resulting races. Background async errors require script error handling. Local enqueue accepts arbitrary JS references, including functions and Buffers, without JSON cloning.

## Initialization, commits and errors

For a new message: initialize state; `onInit` sees `ctx.message === null`; commit initialization; render/send; retain the returned full Message; then call `onCreate`. For attachment, replacement, resume or runtime restoration, `onInit` sees the known message, and `onCreate` is not called. Pending events wait until initialization completes.

`ctx.render()` before the first message exists is an error. First publication is automatic. `onCreate` can inspect dice results and other returned Telegram fields and change state/buttons. Do not replay `onCreate` after a crash with uncertain completion.

Successful handler completion commits changed state and renders it. `await ctx.render()` explicitly commits first and publishes immediately, allowing several updates in one handler. A publish failure does not roll back the saved state or completed effects. On handler error, restore working state to the last committed snapshot before invoking `onError`.

Returning `true` from `onError` means handled; otherwise notify the owner. Successful state changes by `onError` follow the normal commit/render contract. Failure inside `onError` or its recovery render is reported without recursive error-handler invocation. Ordinary handler errors do not automatically kill the shared process or retry the event.

An externally requested delete/replacement waits for teardown. Self-delete returns void after acceptance and invalidates the context immediately. Self-replacement remains awaited: invalidate the old context, perform cleanup without waiting for the suspended calling handler, start the replacement, then resolve that call. Old JS may continue but cannot commit/render/enqueue into the new generation. Generation guards also fence late controller effects.

If first send is definitely rejected, return an error and release provisional resources/quota. If a message was sent and later initialization/render fails, retain a disabled registration with its known ID. If delivery is uncertain, do not resend: retain disabled `delivery_unknown` with `messageId: null`, description, snapshot and committed state. It can be inspected/deleted, but cannot resume/render without a known message. No exactly-once send guarantee is claimed.

## Event queue and recovery

All events for one widget use a sequential FIFO, including admitted agent/other-widget events and debug render jobs. Different widgets share the event loop but have separate queues. No transport-level deduplication is added: two button clicks may mean two actions.

Accepted external replies, reactions and agent/other-widget events are durable before dispatch. Local references remain RAM-only. Callback events are not replayed after disable/crash. Persisted pending events survive restart/resume; events already started at a crash are not automatically retried because effects may be partial. Notify the owner for manual recovery.

Reject/drop the newest event on overflow, preserving older pending events. Local enqueue returns `false` when full without automatically notifying the model. Enqueue on a stopped/deleted context is an error. Agent-facing submission failures are explicit. Load durable events incrementally rather than placing the entire queue in memory.

External event envelopes identify `name`, controller-assigned `source`, `receivedAt`, `delayed` and `data`. Sources are `button`, `reply`, `reaction`, `poll`, `poll_answer`, `agent`, `widget`, and `local`. Preserve original intake timestamps. Mark resumed backlog events delayed; ordinary waiting behind a busy handler does not alone make them delayed. Local arbitrary references remain nonserializable.

See [event examples](widget-event-examples.md) for native payload illustrations. Exact envelope/counter fields and limits for debug control jobs will be finalized with the schema; do not apply the 64 KiB event limit accidentally to the separately allowed 1 MiB replacement state.

## Buttons and external routing

Widget buttons do not use model-button permits. Scripts check current `user_roles()`/membership as needed. Register callback names actually displayed on the current message; reject undeclared/stale actions. System exports such as `render`, `onInit`, `onCreate`, `onReply`, `onReaction`, `onPoll`, `onPollAnswer`, `onStop` and `onError` cannot be button actions. Plain callback strings are allowed; opaque IDs are not mandatory.

A button handler returns `undefined`, `null`, `{}`, a string, or `{text,showAlert}`. It can answer early through `event.respond()` with the same forms; the first answer wins. Do not add an automatic two-second acknowledgement timer. Expired callback acknowledgement does not cancel the action or undo effects.

An active widget with `onReply` intercepts replies; without it, ordinary agent routing applies. Controller commands always win. Disabled replies are retained and suppress normal model triggers. If a corresponding export is absent when backlog is dispatched, discard the event and increment the dropped counter rather than unexpectedly routing it to the model. This also covers a repaired handler removing a subscribed hook. `callback_data` is an exact exported action name in v1, without encoded arguments; derive parameters from state/user/message.

Before dispatching reaction/poll handlers, refresh `ctx.message` from the latest-known controller projection, independently updated on intake. Delayed events must not roll back a newer snapshot or apply the same delta twice. Reaction counts are known observations, not a guarantee of instant completeness.

`onPoll` receives the native Poll update associated by poll ID. `onPollAnswer` updates the last-known per-voter choice projection before dispatch; it does not blindly increment native poll totals. Native totals and answer updates can arrive separately. Bound the inline per-voter projection and explicitly mark incompleteness. Exact bounds/schema belong in the implementation plan; do not promise full voter history. An independently queryable store can be designed if full history becomes required.

## Render types and media

Support one owned message of each existing singleton send type: text, rich, photo, video, animation, document, audio, voice, sticker, video note, location/live location, venue, contact, poll and dice. Albums are not one owned widget message, but ordinary `ctx.api.send` may send albums.

The [render field reference](react-message-render-fields.md) is the native creation/edit inventory. Its historical controller-permits row does not apply to widget buttons: the later no-permits decision above governs widgets. Render cannot pretend an immutable field is editable, silently reroll dice, restart an expired live location or recreate a poll. Closing polls/live locations uses explicit methods. Permit every native cross-type edit supported by Telegram on the same message; the [conversion matrix and live evidence](widget-type-conversions.md) is evidence, not an additional application allowlist. Dispatch through the applicable native method/input type, including live-photo media conversion. Unsupported conversion is an error, never an implicit delete/resend. Refresh ctx.message and current rendering type from the returned Message after a confirmed conversion.

Plain text supports strings with parse mode or explicit entities, and JSX compiled to UTF-16 entities. Do not combine competing formatting representations. Rich JSX follows native rich HTML tags and supports media, maps, lists, expandable blocks and slideshows. Rich rendering replaces the complete document, not arbitrary native patches.

Media `src` remains a string: Telegram `file_id`, `file:relative/path`, or a supported HTTP(S) URL. Paths stay inside the owner sandbox. Keep long-lived source files outside `.temp` if they must survive cleanup.

Keep upload cache in registration RAM. Local keys include source, mtime and size; changed files upload again. URL keys use the complete URL, without automatic remote-content revalidation. Restart may upload again. Native media-role restrictions still apply, especially fresh-upload thumbnails.

Associate uploads with returned Telegram file IDs through a request manifest of rich block paths and media roles. Do not guess correspondence from a flattened positional list. This mapping requires repeated live validation for nested lists/expandable blocks, duplicate/reordered media, covers and all supported rich media types before acceptance.

## Controller API inside handlers

Preserve existing controller argument formats and permissions for the approved capabilities: `send`, `edit`, `delete`, `react`, `copy`, `forward`, `pin`, `unpin`, `read`, `history`, `search`, `topics`, `user_roles`, `members`, `chat_info`, `user_photos`, `download`, `chats`, `vault_get`, plus the six widget tools, own-agent notification, poll closing and live-location stopping.

Notification is explicit during normal processing; routine clicks need not reach the model. Secrets must not be placed in saved state, messages or notifications. Native Node network/filesystem work remains sandboxed. Ordinary `edit` must not bypass an active widget's rendering ownership. Stopping a script does not itself stop a Telegram live-location broadcast. Scheduler, Git, browser/PDF, image generation, controller-owned WebSocket tools and Codex shell tools are not automatically mirrored into `ctx.api`.

## Administrator commands

All commands below require admin/owner of the current bot. They operate without a model turn and cannot address another bot. Selectors refer to the owner agent, not the publication chat.

| Command | Action |
| --- | --- |
| `/widget`, `/widget list [RANGE]` | Current chat agent's active and disabled widgets |
| `/widget list [RANGE] agent AGENT_ID` | Selected agent's widgets |
| `/widget list [RANGE] in CHAT_ID` | Selected chat agent's widgets |
| `/widget list [RANGE] all` | All widgets of this bot |
| `/widget show WIDGET_ID` | Metadata, handler, description, target, status, disable reason and queue counters |
| `/widget delete WIDGET_ID` | Delete the widget, preserving its Telegram message |
| `/widget delete *` | Delete all current chat agent's widgets |
| `/widget delete * agent AGENT_ID` | Delete all selected agent's widgets |
| `/widget delete * in CHAT_ID` | Delete all selected chat agent's widgets |

Use existing `RANGE` semantics, oldest-first ordering and `FROM-TO / TOTAL` headers. Each list item shows code-formatted widget ID, italic status, description, code-formatted owner and publication chat/message IDs, and pending count. `show` does not automatically expose state. Replies/help/errors are English.

Notify the owner on administrative deletion. No manual stop/disable, restart, state-edit or debug-render commands are added; recovery uses agent tools. No bot-wide `/widget delete * all` command is included.

## Final review decisions

The owner/lifecycle, missing-hook, bounded poll projection and callback-name policies above were approved. Worker prohibition is an authoring rule with direct-import/build diagnostics, not a hard adversarial OS boundary: arbitrary sandboxed Node/npm code can create workers through indirect paths. Resource monitoring still applies.

The proposal to freeze outer message type was rejected. All native conversions are allowed, with evidence and residual live-test limitations in the [conversion report](widget-type-conversions.md). The implementation plan must close SDK/native-input coverage gaps, including live-photo replacement inputs, instead of turning those gaps into a Telegram conversion restriction. This does not add separate album/inline/business publishing features beyond the agreed message-addressing scope.

Implementation details to settle in the plan, without reopening agreed behavior: exact schema/counter names; platform memory metrics; sandbox-helper accounting; provisional/retiring quota reservations; debug-runtime allocation/cleanup; render omission semantics; generation fencing; poll projection schema; queue admission transactions; module-instance isolation; and control-job byte accounting.

## Verification and implementation handoff

The existing [sandbox probes](widget-sandbox-verification.md), [memory comparison](widget-memory-verification.md), and [memory-limit probes](widget-memory-limits-verification.md) are feasibility evidence, not tests of an implemented widget SDK.

After this consolidated specification is reviewed, prepare an implementation plan covering storage/migration, sandbox runner and monitoring, SDK/build, controller tools, event routing, Telegram rendering/cache, administrative commands/help, documentation and acceptance tests. Preserve old databases on upgrade.

Required automated coverage includes quotas, cross-chat permissions, invalid selectors, state limits/commit ordering, callback registry/reserved names, delayed FIFO recovery, overflow, disabled routing, partial failures, self-delete/self-replace, stale-generation effects, cleanup deadlines, watchdog/memory termination, and restart behavior. Test failures cannot be represented as successful publication.

Windows and Alpine runtime acceptance must verify filesystem/environment isolation, child termination, process-tree monitoring, heartbeat failure and ordinary asynchronous work. Live Telegram acceptance must verify every supported send/edit family, callback answers, replies, reaction/poll projections, topic routing, live location, and repeated nested rich upload/file-ID mapping. Model-busy independence and cross-chat publication also need live tests.

Update the current English wiki, agent instructions, SDK examples and `/help widget` alongside implementation. Do not present this design as already available in current commands/tools documentation.
