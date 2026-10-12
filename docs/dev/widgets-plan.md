# Programmable Telegram Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user chooses delegation. Follow the checked tasks in dependency order. This document authorizes neither implementation nor commit/push by itself.

**Goal:** Let agents author sandboxed TS/TSX Telegram widgets that process buttons, replies, reactions, polls, timers and local WebSockets independently of model activity, with durable state and administrator controls.

**Architecture:** One controller-supervised sandboxed Node runtime per owner agent serves up to ten widget generations on one event loop. SQLite owns registrations, message projections and durable event admission; the runtime owns working state, local queues and managed resources. All privileged effects pass through the existing controller under freshly checked owner authority and generation fencing.

**Tech stack:** Node >=24.18.1, existing SQLite/`ws`, Codex OS sandbox, esbuild 0.28.2 for fixed-config TS/TSX bundling, a small JSX SDK, external Linux/Windows process monitoring. No React runtime, worker pool, OAuth/MCP extension or new server-wide quota.

**Spec:** [widgets-spec.md](widgets-spec.md), with [native render fields](react-message-render-fields.md), [event examples](widget-event-examples.md) and [conversion evidence](widget-type-conversions.md). The consolidated spec supersedes older discussion proposals.

## Execution status

Implementation was authorized after this plan was reviewed. Work is isolated on `feature/telegram-widgets`, based on `e5dbe01`; the historical planning restrictions and RED/GREEN checklist below are preserved rather than rewritten as a test transcript.

| Tasks | Result |
| --- | --- |
| 1–4: contract, storage, sandbox/build, monitored host | Implemented; focused checks and real platform probes completed |
| 5–9: runtime/context, JSX/state, lifecycle, rendering/media, API | Implemented; race, authority, error/recovery and live rendering checks completed |
| 10–12: Telegram routing, owner lifecycle, administrator commands | Implemented; routing, projection, retention and command tests completed |
| 13: examples, wiki, full regression | Eight examples, current wiki and full regression completed |
| 14: platform and Telegram acceptance | Personal Windows/Alpine and Telegram probes completed; user accepted the updated designated test bot |

See [widgets-verification.md](widgets-verification.md) for evidence and limits. After live acceptance, the user explicitly requested merging directly into `main` and pushing; that supersedes the earlier PR handoff.

## Global constraints

- 10 active plus disabled registrations per agent; 10 logical widget runtimes per bot; no global server cap.
- 256 MiB externally measured runtime-tree memory; 500 ms samples; heartbeat every 5 seconds; terminate after 10 seconds of silence.
- Five seconds total teardown grace; normal asynchronous handlers have no overall execution deadline.
- State <=1 MiB serialized UTF-8 JSON; <=1,000 waiting events; external event <=64 KiB and external pending payload <=8 MiB.
- Disabled retains saved state/backlog; callbacks ignored; replies intercepted; agent/widget submissions rejected. Delete removes registration/state/queue while preserving the Telegram message.
- All native type conversions Telegram allows are permitted; preserve message/widget IDs and never silently delete/resend.
- Same owner permissions/sandbox for cross-chat publication; no bot token, raw Telegram client or arbitrary controller dispatch in the runtime.
- Worker prohibition is an authoring rule plus direct-import diagnostics, not an adversarial isolation promise.
- Only committed state survives runtime failure. Do not automatically retry in-flight effects or restart crashed runtimes.
- English commands/help/instructions/wiki. Designs and test reports stay in `docs/dev`; preserve unrelated local files.
- No product implementation, dependency installation, commit, merge or push during this planning stage.

## Review focus

1. A stale generation finishing after self-replacement must not publish, commit, or disable its replacement (Tasks 5, 7, 10).
2. Context clearing and ordinary history retention must not silently destroy a long-lived widget (Tasks 2, 7, 11).
3. Replies/callbacks in another chat must use the creating agent's authority without invoking the target model (Tasks 8, 10).
4. Uncertain send/edit and storage failure must not duplicate publication or report an unconfirmed effect as successful (Tasks 7, 8).
5. A detached child, Buffer allocation burst, malformed transport frame or hung cleanup must not leave an unmonitored privileged runtime (Tasks 3, 4, 5).

## Execution setup and dependency order

Current design files are untracked in `C:/PROJECTS/tg-assistant-vault`, currently on `feature/master-usage`. Do not implement widget code on that old feature branch accidentally. At execution time, inspect `git status`, current `main` and worktrees; use the worktree skill to create a widget branch/worktree from the intended current base, then transfer only the agreed design/probe files with a reviewed manifest. Preserve personal examples and unrelated local artifacts. User approval of execution is not approval to discard these files or to merge/push.

This is one coordinated feature: runtime, storage, SDK and controller routes depend on common generation/admission interfaces. Use one staged plan rather than ship independent partially exposed features. Tasks 1–4 build tested internal foundations; 5–9 make the core executable; 10–12 expose the complete lifecycle; 13–14 provide release verification.

Run each focused test first against a deliberately absent/incomplete behavior, implement the smallest passing change, and rerun it. Stage only task files if commits are separately authorized. Do not treat planned test snippets below as results already obtained.

## Contract and file map

Keep `src/controller.mjs` as wiring/routing. Add `src/widgets/` modules with the following ownership boundaries:

| Files | Responsibility |
| --- | --- |
| `contract.mjs`, `types.d.ts` | Tool/event schemas, errors, byte/count limits and native scope shapes |
| `store.mjs` | Transactional registration, saved state/message, durable FIFO and counters |
| `sandbox.mjs`, `build.mjs` | Owner profile, immutable handler/dependency builds and SDK materialization |
| `transport.mjs` | Authenticated bounded runtime RPC, replies and disconnect handling |
| `monitor.mjs`, `windows-monitor.cs` | External process-tree sampling, watchdog and termination |
| `host.mjs` | One runtime per agent, bot process-slot reservations, lifecycle and crash handling |
| `runtime.mjs`, `context.mjs`, `queue.mjs` | Sandboxed JS execution, generation-local context, FIFO/resources and commits |
| `render.mjs`, `media.mjs`, `jsx-runtime.mjs` | JSX/native normalization, edit planning and RAM media manifest cache |
| `manager.mjs`, `api.mjs` | Registration operations and approved controller API bridge |
| `events.mjs`, `polls.mjs` | Telegram interception and latest-known projections |
| `src/commands/widget.mjs`, `widgets-format.mjs` | Deterministic administrative commands/formatting |

Reuse existing `src/files/paths.mjs`, `src/access/scope.mjs`, `src/messages/actions.mjs`, `src/messages/callbacks.mjs`, `src/messages/reactions.mjs` and controller tool implementations. Do not fork their authorization/formatting logic into the runtime.

Cross-task interfaces (internal method names are fixed for this plan):

```ts
type WidgetRef = {botId:string, agentId:string, widgetId:string, generation:number};
type WidgetEvent = {
  name:string, source:'button'|'reply'|'reaction'|'poll'|'poll_answer'|'agent'|'widget'|'local',
  receivedAt:string, delayed:boolean, data:unknown,
  user?:object, fromWidgetId?:string
};
type WidgetRecord = WidgetRef & {
  status:'active'|'disabled', chatId:number, messageId:number|null, topicId?:number,
  handler:string, snapshotId:string, description:string, state:object,
  message:object|null, createdAt:number, disabledReason:string|null,
  pending:number, dropped:number
};
// Created in Task 2; implementations return detached JSON values.
createWidgetStore(db): {
  create(input):WidgetRecord, get(widgetId):WidgetRecord|null,
  list({botId,agentId?}):WidgetRecord[],
  save(ref,{state,message?}):void,
  admit(ref,event):{accepted:boolean,seq?:number,reason?:string},
  begin(ref,seq):WidgetEvent, complete(ref,seq):void,
  disableOwner({botId,agentId},reason):void, remove(widgetId):void
};
// Created in Tasks 3–4; injectable fakes are mandatory.
createWidgetHost({config,db,launch,measureTree,clock,onFailure}): {
  reserve(owner):Promise<object>, load(ref,snapshot):Promise<void>,
  request(ref,method,args):Promise<unknown>, release(owner):Promise<void>,
  close():Promise<void>
};
// Created in Task 7; shared by tools, ctx.api and admin commands.
createWidgetManager({db,host,store,build,render,invoke,notify}): {
  set(scope,args):Promise<{widgetId:string,chatId:number,messageId:number}>,
  delete(scope,{widgetId}):Promise<void>|void,
  list(scope):{canCreate:number,items:WidgetRecord[]},
  state(scope,{widgetId}):object,
  event(scope,{widgetId,name,data?}):void,
  render(scope,{widgetId,state?}):void,
  recover():Promise<void>, close():Promise<void>
};
```

Validate state as a plain JSON object: reject cycles, functions, undefined values, nonfinite numbers and exotic prototypes instead of lossy silent coercion. Transport must represent local arbitrary enqueue payloads only inside runtime RAM, never through JSON. Tool `items` use a public projection, not every private `WidgetRecord` field. Public list counters are `pending` and `dropped`; `ctx.queueInfo` uses the same names. Public disable field is `disabledReason`.

Tool selectors: `widgetId` excludes `messageId/chatId/topicId`; otherwise `messageId` optionally with `chatId` selects an existing message; no ID creates. Agent tool calls may address only owned registrations. `set_widget` on disabled resumes and keeps durable backlog, even with a new handler; active targets replace/clear pending. Description is required for new/attach/active replacement/new-handler repair. Creation envelope uses existing names, not new reply/silent aliases.

`widget_event`/`render_widget` return void after admission; asynchronous failures notify the owner. `widget_state` returns last committed state. Debug render replacement state uses the 1 MiB state cap, not the 64 KiB external-event cap: persist the control job's state separately, queue a reference, and account its bytes against the pending 8 MiB budget. It occupies one of the 1,000 pending positions.

## Task 1: Freeze schemas and add executable contract tests

**Create:** `src/widgets/contract.mjs`, `src/widgets/types.d.ts`, `test/integration/widget-contract.test.mjs`.

**Produces:** `WIDGET_LIMITS`, `validateWidgetState(value)`, `validateWidgetEvent(event)`, `validateSetWidget(args,record)`, `assertActionName(name)`, and public schema definitions consumed by tools/manager/runtime.

- [ ] Write contract tests for exact byte boundaries, all set/resume/replace forms, unknown fields, ambiguous targets, description requirements, reserved exports and source spoofing. Include this regression:

```js
test('debug replacement state uses the state budget', () => {
  const state = {text:'x'.repeat(70_000)};
  assert.doesNotThrow(() => validateWidgetState(state));
  assert.throws(() => validateWidgetEvent({name:'vote',source:'agent',
    receivedAt:new Date(0).toISOString(),delayed:false,data:state}), /event_too_large/);
});
```

- [ ] Run `node --test test/integration/widget-contract.test.mjs`; verify RED.
- [ ] Implement byte checks with `Buffer.byteLength(JSON.stringify(value),'utf8')`, explicit plain-value traversal, action export validation and schema shapes. Native hook names are not external/button action names. Runtime supplies `event.respond`, not caller JSON.
- [ ] Run the focused test GREEN. Define all named errors here: `widget_not_found`, `widget_disabled`, `widget_stopped`, `widget_quota`, `runtime_quota`, `queue_full`, `event_too_large`, `state_too_large`, `invalid_argument`, `delivery_unknown`, `sandbox_unavailable`.

## Task 2: Transactional storage and schema upgrade

**Create:** `src/storage/migrations/013.sql`, `src/widgets/store.mjs`, `test/integration/widget-storage.test.mjs`.
**Modify:** `src/storage/database.mjs`, `test/integration/migrations.test.mjs`, `docs/storage.md`.

**Consumes/produces:** Task 1 validation; implements `createWidgetStore(db)` above. Durable snapshots/messages are independent of ordinary `messages` retention.

- [ ] Write upgrade and storage tests: schema 12 with existing bots/chats/notes/tasks/vault/MCP/usage survives upgrade and a second reopen; failed upgrade rolls back; schema 999 is refused. Existing migration assertions expecting 12 become 13.
- [ ] Add FIFO tests for 1,000 count/8 MiB boundaries, atomic sequence reservation, saved-before-dispatch, in-flight marking, counters and stale generation rejection:

```js
// Test setup supplies an isolated db, registered bot b and owner agent a.
const store=createWidgetStore(db);
test('old generation cannot overwrite its replacement', () => {
  const old=store.create({botId:'b',agentId:'a',chatId:1,messageId:7,
    handler:'widget.tsx',snapshotId:'s1',description:'Fixture',state:{step:1},
    message:{message_id:7,chat:{id:1,type:'private'},text:'Fixture'}});
  db.sql.prepare('UPDATE widgets SET generation=generation+1 WHERE widgetId=?')
    .run(old.widgetId);
  assert.throws(() => store.save(old,{state:{stale:true}}), /widget_stopped/);
  assert.deepEqual(store.get(old.widgetId).state,{step:1});
});
```

- [ ] Run `node --test test/integration/widget-storage.test.mjs test/integration/migrations.test.mjs`; verify RED.
- [ ] Migration creates `widgets`, `widget_events`, `widget_control_jobs`, and bounded `widget_poll_answers`; use unique `(botId,chatId,messageId)` for known publication IDs, owner foreign keys/cascades and indexes on owner/status/pollId/sequence. Store full current native Message JSON, state, generation, description, source/snapshot identity, pending bytes, lifecycle intent and timestamps. Nullable message ID supports uncertain delivery.
- [ ] Keep transitions synchronous inside `db.transaction`. Reserve/check widget count transactionally, including provisional and retiring records until cleanup releases them. Recover unfinished deletion intents as deletion, not disabled widgets. No events/state foreign key to ordinary retained `messages` rows.
- [ ] Run GREEN and migration rollback/reopen tests; document schema 13 and retention separation in the current wiki when implemented.

## Task 3: Sandbox launcher, transport and immutable build

**Create:** `src/widgets/sandbox.mjs`, `transport.mjs`, `build.mjs`, `test/integration/widget-sandbox.test.mjs`, `widget-build.test.mjs`, `widget-transport.test.mjs`.
**Modify:** `package.json`, `package-lock.json`; extract shared profile construction from `src/codex/threads.mjs` to `src/codex/permissions.mjs` only if it avoids divergence without changing normal-agent permissions.

**Produces:** `buildWidget(scope,handler):Promise<{snapshotId,manifest}>`, sandbox `launch(owner,entry,args)`, and bounded authenticated host/runtime requests.

- [ ] Write tests denying outside workspace/foreign temp/.git/controller credentials, symlink handler/dependency escapes, direct worker imports, unsolicited controller method calls, oversized/malformed frames and another owner's transport credential.
- [ ] Run the three focused test files RED.
- [ ] Pin `esbuild@0.28.2` with `npm install --save-exact esbuild@0.28.2` only during execution. Fixed build options are `bundle:true`, `platform:'node'`, `target:'node24'`, `format:'esm'`, `jsx:'automatic'`, canonical `jsxImportSource:'@tg-assistant/widget'`, `metafile:true`; no user plugins, install scripts, arbitrary tsconfig hooks or privileged code imports. See [esbuild API](https://esbuild.github.io/api/#jsx) and [installation](https://esbuild.github.io/getting-started/#install-esbuild).
- [ ] Run compilation itself in the owner sandbox, inside the reserved owner runtime's trusted build mode so esbuild helpers remain tracked descendants of that same runtime tree. Do not create an unaccounted sibling builder. Static JS dependencies bundle into the snapshot; capture resolved non-JS assets/package files needed at runtime into the dependency manifest and freeze them. Reject an unresolved dependency with actionable diagnostics rather than silently importing mutable workspace code as a claimed immutable dependency. Runtime filesystem data remains normal mutable sandbox files.
- [ ] Persist approved generation bytes under controller-owned `dataDir/widgets/...`, grant read access only to that owner's exact snapshot/SDK roots, and materialize canonical trusted SDK/runtime assets into a dedicated read-only directory. Never grant read access to all of `src/`, dataDir or the server repository. Stage in own temp, validate regular files/symlinks before copying; garbage-collect unreferenced snapshots after teardown/recovery. SDK declaration copies in the bot workspace are authoring aids, not trusted runtime code.
- [ ] Launch a controller-owned foreground `codex sandbox` with approval never, owner filesystem profile, network enabled, sanitized environment and explicit Node package scope. Windows uses `prefer_mxc` and preserve-symlinks flags proven in the probe. Missing strict backend is `sandbox_unavailable`; no unrestricted fallback.
- [ ] Transport uses existing `ws` over a loopback endpoint with an ephemeral per-runtime capability, controller-bound owner scope, generation-aware requests and a 2 MiB transport frame cap. Bootstrap capability through launcher stdin; never put it in public tool state. Stdout/stderr are bounded logs, not trusted RPC. Expire sessions on exit; whitelist ctx.api methods even for authenticated connections.
- [ ] Run GREEN with fake launch/transport; exercise both real platforms in Task 14 before claiming isolation. Verify native addons/dynamic package resolution used by examples; explicitly report unsupported package patterns instead of claiming all npm packages were tested.

## Task 4: Runtime host, quotas, memory and watchdog

**Create:** `src/widgets/host.mjs`, `monitor.mjs`, `windows-monitor.cs`, `test/integration/widget-host.test.mjs`, `widget-monitor.test.mjs`.

**Consumes:** Task 3 launcher/transport; **produces:** `createWidgetHost` interface. Monitor functions `measureTree(rootIdentity)` and `terminateTree(rootIdentity)` are injectable.

- [ ] Write fake-clock/process tests for concurrent slot reservations, disabled-only owners, quota release, memory above 256 MiB, dead heartbeat at 10 seconds, async-wait heartbeat health, root exit, PID reuse, descendants and fail-closed monitor startup.
- [ ] Run focused host/monitor tests RED.
- [ ] Linux reads `/proc` externally using PID+start-time identity; Windows uses a trusted persistent C# helper based on OS process enumeration, parent IDs, creation times and working-set counters. Compile/cache the helper once with available Windows tooling; never invoke PowerShell per 500 ms sample. No new Linux host packages, job memory limit or cgroup delegation requirement.
- [ ] Use summed RSS/working set of the dedicated launcher tree and its tracked descendants, conservatively including sandbox helpers; document double-counting of shared pages. Track discovered children across reparenting and verify detached-child coverage live. Sample failure disables/terminates rather than silently giving an unlimited runtime. This is a monitored threshold, not a hard exact RAM cap.
- [ ] Heartbeat and memory monitors run outside untrusted handler code. A dead shared event loop kills that owner's runtime only. Reserve one runtime per owner and at most ten per bot, including temporary debug/build execution; reuse an existing owner runtime. Build-only temporary reservations release on completion.
- [ ] Run GREEN and verify one failure notification with affected IDs, no automatic restart, last committed state preservation. On cleanup timeout, stop the entire tree and disable surviving owner's widgets.

## Task 5: Shared event loop, context and managed resources

**Create:** `src/widgets/runtime.mjs`, `context.mjs`, `queue.mjs`, `test/integration/widget-runtime.test.mjs`, `widget-queue.test.mjs`, `widget-resources.test.mjs`.

**Consumes:** Task 1 envelope and Task 3 transport. **Produces:** runtime commands `load`, `dispatch`, `render`, `retire`, and generation-fenced `ctx` methods. Host/controller handles JSON external admissions; `ctx.enqueue` creates runtime-local sequence entries without serializing payload references.

- [ ] Write tests for FIFO, arbitrary local references, running-versus-pending count, queue overflow, per-widget ESM globals, managed timeout removal, reverse disposal, cleanup continuing after a disposer throws and invalid contexts rejecting new effects:

```js
test('local enqueue preserves references and reports overflow', () => {
  const q = createLocalQueue({capacity:1}); // exported by queue.mjs
  const data={fn:()=>42};
  assert.equal(q.enqueue('tick',data),true);
  assert.equal(q.enqueue('tick',{}),false);
  data.changed=true;
  assert.equal(q.take().data,data);
  assert.equal(data.changed,true);
});
```

- [ ] Run the three focused files RED.
- [ ] Load each immutable handler through a distinct generation module identity; bundle module globals per widget. Share one event loop without workers. Internal scheduler coordinates DB pending sequence heads with local sequence entries, preserving one FIFO rather than independent durable/local limits.
- [ ] Provide `ctx.setTimeout/setInterval/clearTimeout/clearInterval/use/defer/signal`, `widgetId`, `state`, read-only latest message, queue counters, `api`, `enqueue`, and awaited `render`. Local enqueue full returns false without model notification; stopped/deleted throws. Abort/cancel managed resources on retirement, then `onStop` and reverse disposers within five seconds. Old detached promises can run but generation-bound effects remain rejected.
- [ ] Add self-replacement test with suspended calling handler: retire without waiting that specific frame, start new generation, then resolve the old lifecycle RPC. Self-delete accepts and returns void immediately. Cross-widget cyclic replacement must terminate within teardown grace rather than rely on heartbeat to detect an async deadlock.
- [ ] Run GREEN; test two widgets sharing one runtime do not share handler globals and one healthy async task does not block another widget's queue.

## Task 6: JSX authoring SDK and saved-state semantics

**Create:** `src/widgets/jsx-runtime.mjs`, SDK declaration additions in `types.d.ts`, `test/integration/widget-jsx.test.mjs`, `widget-state.test.mjs`; build fixture TSX modules under `test/fixtures/widgets/`.

**Produces:** `jsx/jsxs/Fragment` compile-time entry, `normalizeRender(value)` used in Task 8, state commit protocol `save(ref,{state,message?})` and runtime-side rollback logic.

- [ ] Write TSX tests for native rich elements, nested details/lists/slideshows/maps/media, plain-text entities with emoji UTF-16 offsets, escaping dynamic text, caption entities, exact one content field, reserved button names and incompatible formatting. Functional TSX components expand into the same native tree without React hooks.
- [ ] Write state tests: unchanged handler does not spuriously publish; several awaited `ctx.render()` commits occur in order; publish failure retains committed state; `onError` starts with last committed state, returns true to suppress owner notification, and cannot recurse indefinitely:

```js
test('intermediate commit survives a later action error', async () => {
  await runtime.dispatch(ref,{name:'failAfterRender',data:null});
  assert.deepEqual(store.get(ref.widgetId).state,{step:1});
  assert.equal(telegramCalls.filter(c=>c.method==='editMessageText').length,1);
});
```

- [ ] Run focused JSX/state tests RED.
- [ ] Normalize a send-compatible object or rich JSX. A root native JSX tree/fragment is rich; `{text:<><b>Hello</b></>}` selects plain-text entity compilation; `{photo:src,caption:<><i>Caption</i></>}` selects caption entities. No custom wrapper tag is needed. String parse_mode remains available; don't conflate native rich HTML with ordinary Telegram HTML formatting.
- [ ] Implement save-before-publish, changed-state auto-render after successful handlers, error rollback and single recovery handler invocation. Pure render may be awaited if it returns a Promise, but side effects remain outside the render contract. Validate output and JSON state before persistence/publication.
- [ ] Run GREEN and compile all representative TSX fixtures through Task 3, not a separate privileged evaluator.

## Task 7: Widget manager and lifecycle operations

**Create:** `src/widgets/manager.mjs`, `test/integration/widget-manager.test.mjs`, `widget-recovery.test.mjs`.
**Consumes:** store/host/build/runtime; **produces:** manager interface in the contract map.

- [ ] Write create/attach/active-replace/disabled-resume/repair tests with correct description/state/backlog behavior, provisional count races, uncertain send, known-send/DB-ack gaps, teardown reservations and disabled debugging.
- [ ] Pin the disabled-debug exception explicitly: active control jobs share event FIFO; a disabled widget's external backlog is paused, so admitted debug jobs run in their own ordered control lane without draining/skipping that backlog. Both lanes share the count/byte budgets; activation waits for an in-flight debug job or retires its generation safely. This makes the approved no-backlog debug behavior executable rather than deadlocking behind paused events.
- [ ] Run both focused files RED.
- [ ] Create path: reserve quotas → validate/build snapshot → persist provisional intent → onInit with null message → save → render/send once → persist Message/ID → onCreate → save/render changes. Attach/resume/replace skip onCreate. Confirmed rejection cleans provisional resources; uncertain send retains disabled null-ID registration and returns `delivery_unknown` with widgetId. Known send followed by storage failure cannot be treated as confirmed rejection or sent again.
- [ ] External delete/replacement awaits teardown. Self-delete records deletion intent before acknowledgement; old ctx is revoked immediately. Active replacement clears pending; disabled resume keeps pending. Failed replacement has no automatic rollback. Own set_widget lifecycle RPC is allowed to finish after invalidating its calling ctx; later old requests/auto-commits/errors cannot affect the new generation.
- [ ] Debug render active enters target FIFO and returns acceptance. Disabled debug uses the same owner sandbox/quotas without onInit or backlog, passes only saved/supplied state to render, keeps buttons disabled and releases an otherwise temporary runtime. Top-level import side effects are possible, so dispose/unload its generation and stop temporary runtime; never call an unrestricted host evaluator. Reject unknown message ID.
- [ ] Recovery restores previously active registrations via onInit, leaves disabled disabled, removes durable deletion intents, discards callbacks/local RAM events, preserves unstarted durable events with delayed=true and does not retry started ones. Notify once about uncertain in-flight effects.
- [ ] Run GREEN. Prove an idle controller with a busy model can still process manager/debug requests independently of model lifecycle.

## Task 8: Native send/edit dispatcher and complete media handling

**Create:** `src/widgets/render.mjs`, `media.mjs`, `test/integration/widget-render.test.mjs`, `widget-media.test.mjs`.
**Modify:** `src/messages/actions.mjs`, `src/messages/callbacks.mjs`, `test/integration/message-actions.test.mjs`, `test/integration/buttons.test.mjs`.

**Produces:** `renderWidget(ref,state):Promise<{message,renderHash}>`, validated manifest/cache; common native edit planning shared with ordinary controller messaging.

- [ ] Write exact dispatch tests for every type in the spec/render annex, all verified conversions, live-photo InputMedia coverage, keyboard-only edits, immutable fields, poll/live-location stopping, message effect creation and partial storage failures.
- [ ] Include the conversion regression:

```js
test('text converts to photo on the same Telegram message', async () => {
  const result=await messages.edit(scope,{messageId:7,photo:'attach://pic',
    uploads:{pic:'fixture.jpg'}});
  assert.equal(calls[0].method,'editMessageMedia');
  assert.equal(calls[0].args.message_id,7);
  assert.equal(calls.filter(c=>c.method.startsWith('send')).length,0);
  assert.equal(result.error,undefined);
});
```

- [ ] Run focused widget render/media plus existing message/button tests RED.
- [ ] Replace the application's blanket original-type guard with native method/input capability planning. Telegram decides admissible results; do not impose the measured matrix as a permanent source allowlist. Use editMessageText, editMessageMedia, editMessageCaption, editMessageLiveLocation, editMessageReplyMarkup as appropriate. Never send a replacement automatically when edit fails. Clear stale outer-type fields after confirmed conversion; read returned Message as authoritative.
- [ ] Implement send shape coverage including native live-photo mapping needed for all conversions; preserve already-agreed content families, rich full replacement, native poll options and special stop methods. Add `message_effect_id` to ordinary send schema/help. Store final widget projection independently of ordinary retained history.
- [ ] Treat render as full target representation: absent editable caption/inline keyboard means clear; absent immutable creation metadata remains frozen. Native-generated dice/poll results are observations, not authoring inputs. Avoid edits when normalized desired output is unchanged; debug still computes render.
- [ ] Media source rules: `file:` paths validate owner access/symlinks, file_id passes through with ordinary controller provenance where applicable, HTTP(S) uses native per-type constraints. Widget-local cache is trusted only for uploaded files whose returned ID was confirmed. Key includes media role/type and local mtime/size, or exact URL. Never log secret URLs.
- [ ] Request manifest maps each rich nested block path/media role to returned native file metadata; handle duplicates/reordering, covers and all six rich media families. Ambiguous correspondence fails safely instead of guessing. Thumbnails are fresh uploads, not reusable IDs. Disabling rich buttons preserves cached media through native input conversion.
- [ ] Run GREEN; live rich mapping is mandatory in Task 14. An offline stub returning fabricated IDs does not satisfy that acceptance gate.

## Task 9: Shared controller API authority and agent tools

**Create:** `src/widgets/api.mjs`, `test/integration/widget-api.test.mjs`.
**Modify:** `src/controller.mjs`, `src/codex/threads.mjs`, `src/agents/lifecycle.mjs` only for necessary authority/wiring separation.

**Consumes:** Task 7 manager; **produces:** six dynamic tools and `ctx.api` bridge preserving approved current signatures/results.

- [ ] Write tests for cross-bot/private boundaries, foreign enabled chat denial, role revocation, native API method whitelist, generation revocation immediately before Telegram effects and context-clear survival.
- [ ] Run focused API tests RED.
- [ ] Separate owner authorization from Codex thread/context tokens. Widget requests derive scope on the controller from the persisted owner and generation; caller cannot supply botId/agentId/threadId to escalate. Do not pass stale model `scope` tokens to a permanent runtime or weaken normal-agent `assertCurrent` checks.
- [ ] Reuse controller implementations for send/edit/delete/react/copy/forward/pin/unpin/read/history/search/topics/user_roles/members/chat_info/user_photos/download/chats/vault_get, plus widget methods, own notify_agent, stop_poll and stop_live_location. Exclude shell/image/MCP/scheduler/Git/browser/PDF/controller-WS tools from automatic ctx.api exposure. Block ordinary edit of active widget-owned messages except renderer dispatch.
- [ ] Register dynamic tool schemas and brief service instructions: one-file authoring; SDK path; owner/target distinction; fresh role queries; queue/timer practice; file reuse; state secrecy; conversion asymmetry; quota inspection and recovery. Add runtime errors to consistent controller error handling.
- [ ] Do not hold a lifecycle request inside the same BotGate scope it waits to drain. Keep set/delete scheduling separate from short effect leases; test self-replacement and `/agent stop` alongside in-flight widget calls.
- [ ] Run GREEN with existing user-role/vault/access tests; ordinary agent tools keep their established contracts.

## Task 10: Telegram routing, callbacks and poll projections

**Create:** `src/widgets/events.mjs`, `polls.mjs`, `test/integration/widget-events.test.mjs`, `widget-polls.test.mjs`.
**Modify:** `src/controller.mjs`, `src/telegram/polling.mjs`, `src/messages/reactions.mjs`; extend `test/integration/reactions.test.mjs` and `telegram.test.mjs` as needed.

**Produces:** `routeWidgetUpdate(botId,update):Promise<boolean>` and canonical intake projection updates; true means the widget consumed the ordinary agent route.

- [ ] Write priority tests: controller commands → widget registry → ordinary model button/reply behavior. Include disabled replies without hooks, channel/passive-target callbacks, owner-agent busy, current button-name registry, no permits, first callback response and repeated clicks.
- [ ] Test projection-before-dispatch explicitly:

```js
test('an old reaction event does not roll back the latest message', async () => {
  await intakeReaction(oldReaction);
  await intakeReaction(newReaction);
  await resumeAndDrain(widgetId);
  assert.deepEqual(observedMessageSnapshots[0].reactions,latestProjection);
});
```

- [ ] Run event/poll/reaction tests RED.
- [ ] Widget callbacks are looked up by persisted `(botId,chatId,messageId)`, not by whether the publication chat has an enabled agent. Validate name against the current rendered registry. Ignore disabled callbacks with empty ack; do not queue them. Implement event.respond plus returned answers first-wins; no 2-second auto-ack timer.
- [ ] Commands remain priority before persistence/routing. Noncommand replies persist history first, then widget interception before chat-agent enabled/trigger checks. Active missing onReply falls back normally; disabled captures bounded durable backlog. Missing hook at resume drops/counts, never triggers model unexpectedly.
- [ ] Add `poll` and `poll_answer` to allowed_updates. Associate native poll IDs with widget snapshots; update canonical latest-known poll/reaction projections on intake even when queue is disabled/full. Before dispatch refresh ctx.message; never replay an old delta into the current snapshot.
- [ ] Bound known-answer projection/store to 1,000 voters and 256 KiB per widget, with oldest-known-voter eviction and explicit `complete:false`/evicted count. It is a bounded current observation store, not full voter history. Individual answers do not increment native Poll totals. Native option persistent IDs and voter_chat identities are preserved. Use a separate native poll snapshot and bounded answer projection in ctx.message.
- [ ] Enforce external event size limits before durable admission; oversized Telegram payloads are dropped/counted, with enough diagnostics for the owner to know data was skipped. Raw media bytes are never embedded. Queue overflow updates canonical known message state but does not dispatch the dropped event.
- [ ] Run GREEN and test duplicate button events both execute, external source identity cannot be spoofed, reply topic metadata is retained and callbacks do not accidentally start loud mode/model turns.

## Task 11: Agent/chat/bot lifecycle and history retention

**Modify:** `src/controller.mjs`, `src/commands/master.mjs`, `src/storage/database.mjs`, `src/storage/retention.mjs`, `src/main.mjs`, `src/commands/files.mjs`, `src/git/setup.mjs`.
**Create:** `test/integration/widget-lifecycle.test.mjs`, `widget-retention.test.mjs`.

- [ ] Write tests for `/agent clear`, stop/start, agent deletion, bot removal/leave, ordinary Telegram delete, migration, rules/model refresh, file/Git reset and shutdown with active handlers.
- [ ] Run lifecycle/retention tests RED.
- [ ] Clear context preserves widgets and their authority; stopping an owner disables all its widgets and terminates runtime; starting the agent does not silently activate individually disabled widgets. Explicit set_widget resumes them. Deleting owner/bot removes registrations after generation revocation and best-effort keyboard disabling, even if cleanup fails.
- [ ] Deleting a publication message through controller deletes its widget registration. Leaving/removing a publication chat deletes registrations targeting that chat, including foreign-owner widgets, after fencing effects; preserve other owners' remaining registrations. Basic-group migration rewrites owner/publication chat IDs and projections transactionally, without losing message identity or backlog.
- [ ] Keep active/disabled widget message projections across the 30-day history cleanup; no fake reinsertion into ordinary history. Immutable snapshots live outside the bot wiki/temp reset tree. Permanent file source deletion can make a future uncached upload fail explicitly but does not delete a registration.
- [ ] Shutdown stops processing/resources and drains bounded cleanup while preserving previously active status for ordinary restart; crash disablement persists disabled. Startup recovery runs before publication-ready status/polling and respects process limits; active registrations that cannot reserve a required runtime become disabled with an explicit reason, never bypass quota.
- [ ] If the owner model is disabled/unavailable, preserve failure diagnostics in widget state metadata/status without reactivating its agent merely to deliver an error. Failed notification delivery does not undo disabling/deletion.
- [ ] Run GREEN with stop-race, maintenance, forum migration and retention regressions. Verify closing waits manager/host shutdown before database close.

## Task 12: Administrator commands, help and status formatting

**Create:** `src/commands/widget.mjs`, `widgets-format.mjs`, `test/integration/widget-commands.test.mjs`.
**Modify:** `src/commands/router.mjs`, `contract.mjs`, `help.mjs`, `test/integration/command-contract.test.mjs`, `help-rules.test.mjs`.

- [ ] Write all agreed `/widget` forms and authorization/filter-before-pagination tests; list owner filter must differ from publication chat filter. Include no raw state/secrets in show and one administrative deletion notification to owner.
- [ ] Run focused widget/command/help tests RED.
- [ ] Implement `/widget [list] [RANGE]`, `[agent AGENT_ID|in CHAT_ID|all]`, `show WIDGET_ID`, `delete WIDGET_ID`, and `delete * [agent AGENT_ID|in CHAT_ID]`. No all-delete, manual disable, render or state-edit commands. Reuse current argument parser/RANGE rules and admin/owner roles, not Telegram-native moderator status.
- [ ] Format oldest-first list with range header, code IDs, italic status, description, owner/publication IDs and pending count. Show handler/topic/reason/counters without saved state. Errors point to `/help widget`; replies stay in originating forum topic. Bulk deletion reports partial failures honestly without rerunning completed deletions.
- [ ] Run GREEN; admin commands cannot reach another bot or disclose runtime counts in agent-facing list tools.

## Task 13: Examples, wiki and full offline regression

**Create:** `docs/widgets.md`, executable authoring examples under `docs/dev/examples/widgets/`: pagination, consent-voting, timer, WebSocket display, dice-onCreate, rich media update, live-location tracking and error repair.
**Modify:** `README.md`, `docs/index.md`, `architecture.md`, `agents.md`, `agent-contract.md`, `message-events.md`, `messaging.md`, `commands.md`, `storage.md`, `security.md`, `operations.md`, `docs/dev/check-wiki.mjs`.

- [ ] Document SDK exports/types, all six tools, lifecycle/backlog, buttons/roles, timer cleanup, quotas/memory uncertainty, supported send fields/conversions, owner targets, caching and recovery. Correct affected stale statements only where source now verifies behavior. Master-bot commands remain separate.
- [ ] Compile/test every example through the real sandbox build path using fake Telegram, assert no unexpected side effect/model turn, and include representative create/action/error/recovery traces in `test/integration/widget-examples.test.mjs`.
- [ ] Add wiki validation coverage for new article/tool names/examples and documented dynamic-tool count. Do not hardcode the old count of 40.
- [ ] Run `node --test test/integration/widget-examples.test.mjs`, then `npm test`, `node docs/dev/check-wiki.mjs`, and `git diff --check`. Record exact outputs and distinguish offline results from live acceptance.
- [ ] Review spec coverage and generation/privilege boundaries inline. If user chooses delegated execution, follow that skill's task/branch review gates; do not spawn reviewers merely because this plan exists.

## Task 14: Windows/Alpine and live Telegram acceptance

**Create:** `test/manual/widget-runtime-acceptance.mjs`, `test/manual/widget-telegram-acceptance.mjs`, `docs/dev/widgets-verification.md`. Extend/reuse `test/manual/widget-type-conversion-probe.mjs`.

- [ ] Before Linux tests, verify Docker availability and the designated container identity. Use isolated synthetic fixture paths, nonroot execution and short-lived test runtimes. Do not stop the existing service without the user's authorization for that disruption.
- [ ] On Windows and Alpine verify strict filesystem/environment isolation, npm package/file asset access, child/detached-child termination, 500 ms OS memory sampling with Buffers/children, synchronous hang, long async heartbeat health, self-replacement and cleanup timeout. Runtime/version mismatch remains warning-only generally, but a widget sandbox that cannot enforce isolation fails closed.
- [ ] Reproduce 49 native conversion checks with current code; add live-photo media coverage if fixtures are available. Always validate returned source/target type, same message ID and no duplicate sends. Keep tokens outside output, avoid polling conflicts, and clean only newly created fixture messages.
- [ ] Test all ordinary supported message send/edit families with keyboards, all rich media roles and nested lists/details/slideshows/maps, repeated upload cache hits, changed local files, duplicate/reordered media, thumbnails/covers, native poll events and live-location updates/stop. A successful simple rich photo is insufficient proof of recursive manifest mapping.
- [ ] Test a widget while its model generates images/holds an async task, and cross-chat publication in an observed permitted passive target. Verify no model callback turns, correct owner notification and topic preservation.
- [ ] Request user clicks/replies/reactions/votes only where a real non-bot user is required. Voice/video-note reception requires privacy permission; do not change user privacy settings or claim unsupported source transitions were tested when creation failed. Telegram events unavailable to this bot are recorded as limitations.
- [ ] Exercise restart with pending events, disabled repair/debug, administrator delete and generation shutdown while events arrive. Known sent messages remain identifiable after injected controller storage failure. Record any uncertain effects and expected in-flight non-retry behavior.
- [ ] Run a fresh `npm test`, wiki check and diff check after acceptance-driven fixes. Summarize exact passed, failed and not-run gates; any unresolved isolation, generation fencing or rich-ID mapping defect blocks a claim of completion.

## Handoff

Spec coverage: ownership/runtime/quotas → Tasks 1, 3, 4, 9; lifecycle/state/resources → Tasks 2, 5–7, 11; events/recovery/projections → Tasks 2, 5, 7, 10; native types/media/conversions → Tasks 6, 8, 14; tools/admin/help → Tasks 1, 9, 12; documentation/deployment/evidence → Tasks 13–14. The five Review Focus regressions have explicit owning tasks. No known agreed feature is intentionally deferred.

This plan is ready for review. Recommended execution is native task-by-task in this session because the controller/runtime/storage interfaces are tightly coupled and the harness already has the necessary repository/live-stand context. Delegated execution remains an option if the user prefers its extra review/context cost.

After approval of the plan and execution method, implement all stages continuously until complete or user participation is needed. The live user actions in Task 14 are the expected interactive handoff. Commit/push/merge requires explicit session authorization; none is inferred from approval of this plan.
