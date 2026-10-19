# Guest Mode v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in this session. Do not delegate unless the user requests it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an explicit guest mention invoke its author's existing personal agent, which may publish an ordinary response or an already rendered widget through the existing tools.

**Architecture:** Store guest requests separately from ordinary chat history and enqueue compact events in the existing personal-agent queue. Extend `read`, `send` and `set_widget_view` with `guestRequestId`; translate supported output to `answerGuestQuery` and register every confirmed inline message independently. Reuse inline ownership/buttons and widget execution, without hidden routing markers, implicit guest reply handling or local single-answer enforcement.

**Tech Stack:** Node.js >=24.18.1, ESM, built-in SQLite, existing Codex App Server dynamic tools, Telegram Bot API, existing sandboxed widget runtime. No new dependency.

**Spec:** [Accepted concept](../guest-message-concept.md). Read it with [live evidence](../guest-message-verification.md); the [deferred reply investigation](../guest-message-reply-routing-future.md) is excluded from implementation.

**Status:** Implementation and planned representative acceptance completed in the isolated feature worktree. The initial base was `da40079` with schema 16; the feature uses additive schema 17. Automated and live results, cleanup, and explicitly unverified live extensions are recorded in the linked verification report. Validation completed before integration; the user subsequently authorized commit, merge into main and push. Production deployment is a separate action.

## Global constraints

- Explicit native mentions only: a guest reply without a new mention is ignored. A mention in a reply selects the new author's personal agent, never the quoted message/widget owner.
- No available enabled personal agent means silence. Never create/enable one from a guest invocation.
- A member bot keeps ordinary group-agent behavior; absent/disabled/stopping chat agent means silence, with no personal fallback.
- Guest IDs and ordinary chat/message IDs are separate namespaces. Do not save guest messages through `db.saveMessage`, create connected chats from them, or grant history/write permissions from them.
- Retain guest requests, complete incoming messages and publication records for **30 days from receipt**. Retain existing live-widget ownership exceptions. Storage lifetime is not a guaranteed Telegram answer window.
- Sent invocations are independent. Preserve their identities through queue batching; a new request never cancels an earlier one. No inline drum, scroll heuristic or one-hour inline lifetime applies.
- An answer is optional. No response placeholder, private warning, reminder, rerun or automatic replay merely because a model turn ended, the controller restarted or a retained request is unanswered.
- Instruct the agent to answer at most once. Do not add a local request reservation, consumed flag, count limit or busy/already-answered precheck. Every authorized explicit call reaches Telegram; every confirmed success retains its own inline message and view.
- No blind automatic send retries, including after uncertain delivery or confirmed publication followed by storage failure. Keep real errors and confirmed/uncertain outcomes distinct.
- Existing widget state, timers, view lifecycle, limits, ordinary routing, inline pagination, file rules and callback permits remain compatible. Wordle source files must remain unchanged.
- Games, invoices, polls, dice, video notes, `sendMediaGroup` albums and ordinary reply keyboards have no supported v1 guest conversion. Reject unsupported fields/options before publication, without falling back to a private send.
- Runtime prompts, errors and maintained wiki articles are English. Preserve user-provided text/names. Keep credentials, personal history and runtime addresses out of committed documents/tests.
- Follow `AGENTS.md`: development material stays under `docs/dev/`; tests under `test/`. Commit, push and merge only with current user authorization.

## Review focus

1. Two users/chats, or a guest ID numerically equal to a known ordinary address: no cross-agent access, wrong destination or inferred ordinary permission. Covered by Tasks 1, 2 and 4.
2. Simultaneous `send`/widget publications for one request: Telegram may accept both; register both, without overwriting a message/view or adding a local answer limit. Covered by Tasks 4 and 5.
3. Success followed by local failure/restart, including a click before view binding: retain exact confirmation evidence, route only by an established native address, and never republish automatically. Covered by Tasks 4–6.
4. Previously saved agent contexts may retain old developer instructions on resume: document the existing explicit `/agent clear` remedy; do not silently discard conversations. Covered by Tasks 7 and 8.
5. Media accepted by ordinary `send` may lack required native inline metadata or a supported transport: validate per type, preserve file authorization and fail before effect rather than quietly changing the content. Covered by Tasks 3, 5 and 8.

## Execution setup and file boundaries

This plan was prepared in the existing isolated design worktree. At implementation time create a new isolated worktree `.worktrees/guest-mode-v1`, branch `feat/guest-mode-v1`, from the verified current main tip, using `superpowers:using-git-worktrees`. Carry only these guest design/evidence/plan files into it; preserve all other checkouts and untracked files. If its code/schema differs from the inspected baseline, reconcile file names and migration number before edits; do not reset an existing branch or overwrite a worktree. Do not copy credentials into tracked files.

| Unit | Responsibility / files |
| --- | --- |
| Guest persistence | New `src/guest/store.mjs`, schema `src/storage/migrations/017.sql`; update `src/storage/database.mjs`, `src/storage/retention.mjs` |
| Admission/event projection | New `src/guest/events.mjs`; update `src/controller.mjs`, `src/telegram/polling.mjs`; reuse `src/telegram/short-message.mjs` |
| Output conversion | New `src/guest/results.mjs`; share native validation in `src/inline/results.mjs` without changing inline result ordering or policy |
| Publication and recovery | New `src/guest/service.mjs`, `src/guest/receipts.mjs`; reuse `src/inline/store.mjs`, `src/inline/events.mjs`, `src/inline/messages.mjs` |
| Widget integration | Update `src/widgets/manager.mjs`, `render.mjs`, `service.mjs`, `views.mjs`, `receipts.mjs`, `contract.mjs`, `types.d.ts`; retain runtime view freezing and normal widget queues |
| Agent contract | Update `src/codex/threads.mjs`, controller tool dispatch, and contract tests |
| Automated fixtures | New `test/helpers/guest-fixture.mjs` and the `guest-*.test.mjs` files named below; reuse existing inline/widget and unchanged Wordle helpers |
| Live acceptance | New `test/manual/guest-acceptance.mjs` and `test/integration/guest-acceptance.test.mjs`; extend the guest verification document with actual results |
| Documentation | Add implemented `docs/guest-mode.md` during implementation; update wiki articles and development navigation in Tasks 7–8 |

## Interfaces chosen for implementation

The following are implementation choices. They do not add an extra agent tool or a new guest message-body language.

```js
// Compact event: reuse shortMessage fields, but omit ordinary address selectors.
{
  eventType: "guest_message",
  guestRequestId: "OPAQUE_REQUEST_ID",
  date: "2026-10-19T12:00:00.000Z",
  from: {userId: 123, name: "Caller"},
  chatType: "supergroup", // optional chatTitle when supplied
  textPlain: "@example_bot publish Wordle"
  // Existing short content/format/truncation indicators as applicable.
}

read({guestRequestId})                    // -> {messages:[savedNativeGuestMessage]}
send({guestRequestId, text:"Hello"})      // -> {inlineMessageId}
set_widget_view({widgetId, send:{guestRequestId}, props:{}})
// -> {viewId, target:{inlineMessageId}}
```

- Full reads use `readableDates`; preserve native available reply/quote/attachment data. The short event omits `messageId`, `replyTo`, topic/album address selectors and raw query IDs; native IDs in a full read are context, not ordinary tool destinations.
- For `read`, exactly one addressing mode is allowed: `messageIds` (+ optional `chatId`), `inlineMessageId`, or `guestRequestId`. Reject mixed selectors at both schema and runtime levels.
- For a guest send, `guestRequestId` excludes `chatId`, `topicId`, ordinary `reply_parameters`, uploads and ordinary-send-only options. A plain ordinary `send` keeps its private/default destination and its existing result shape, including buffer sends.
- Pending widget render target: extend the read-only render/view snapshot type with `{guestRequestId:string}`. This is not a persisted live `WidgetTarget`. Replace it with `{inlineMessageId}` after confirmed publication; do not invent `chatId` or `messageId`.
- Persist a request once per `(botId, nativeQueryId)` for inbound-update idempotence, not outbound deduplication. Each explicit publication gets a separate `publicationId`; there is no uniqueness constraint on the number of publications per request.
- Read/send authorization uses the selected bot/agent and caller recorded at receipt; publication also rechecks the current personal agent, enabled state, role, deletion/stop and request expiry immediately before the external effect.
- Missing, expired or foreign request handles return `guest_request_unavailable` without revealing another agent's data. A known prior success does not make the request locally unavailable.
- Retained requests survive restart. The normal queue remains volatile; do not automatically replay unanswered requests/model work. Publication receipts recover local registration only, never repeat `answerGuestQuery`.

## Task 1: Persist isolated guest requests and publication attempts

**Files:** Create `src/guest/store.mjs`, `src/storage/migrations/017.sql`, `test/integration/guest-storage.test.mjs`; modify `src/storage/database.mjs`, `src/storage/retention.mjs`, `test/integration/migrations.test.mjs`, `test/integration/retention.test.mjs`, and schema-version expectations in `test/integration/usage-storage.test.mjs` and `test/integration/vault.test.mjs`.

**Interfaces:** `createGuestStore(db,{now=Date.now})` returns `record({botId,agentId,callerUserId,updateId,message}) -> {request,created}`, `get(scope,guestRequestId) -> request`, `beginPublication(scope,{guestRequestId,prepared,viewId?}) -> publication`, `saveOutcome(publicationId,outcome)`, `publications(scope,guestRequestId)` and `cleanup(now)`. `request` contains the private native query/message and immutable original owner/receipt/expiry; public projections do not leak them accidentally. Publications have independent IDs and confirmed/rejected/unknown outcomes, never a request-consumed status.

- [x] Write failing storage/migration tests: equal guest/ordinary numeric IDs never touch `messages`/`chats`; another bot/agent cannot `get`; repeated inbound query preserves handle and first receipt; two publication attempts for one request both persist; caller cannot rewrite the selected agent.
- [x] Run `node --test test/integration/guest-storage.test.mjs`; expect missing-module/API failures before implementation.
- [x] Add guest request and publication tables with bot/agent deletion cascades, expiry indexes and inbound-query uniqueness. Update schema ceiling/loop from 16 to 17 and migration expectations. Guest records use `receivedAt + 30 * 86400000`; publish attempts inherit that deadline. Cleanup never deletes live widget state/views or inline ownership needed by a live view. Keep migration transactions synchronous and rollback-safe.
- [x] Add tests: schema-16 data, existing agents/buttons/views and old Wordle registrations survive upgrade/reopen; expiry boundary is enforced during reads/writes even between daily sweeps; rejected/unknown attempts remain inspectable; late attempts do not extend the original request lifetime; expired rows clean silently without removing live inline views.
- [x] Run `node --test test/integration/guest-storage.test.mjs test/integration/migrations.test.mjs test/integration/retention.test.mjs test/integration/widget-view-migration.test.mjs test/integration/usage-storage.test.mjs test/integration/vault.test.mjs`; expect all passed. Record the checkpoint; commit only if authorized.

## Task 2: Admit explicit mentions and enqueue compact events

**Files:** Create `src/guest/events.mjs`, `test/helpers/guest-fixture.mjs`, `test/integration/guest-events.test.mjs`, `test/integration/guest-controller.test.mjs`; modify `src/controller.mjs`, `src/telegram/polling.mjs`; extend `test/integration/message-triggers.test.mjs` if shared mention extraction changes.

**Interfaces:** `explicitGuestMention(message,bot) -> boolean`, `shortGuestMessage(message,guestRequestId) -> event`, `createGuestEvents({store,resolveActor,enqueue,isKnownMember}) -> {receive(botId,update)}`. `receive` processes only `update.guest_message`; existing ordinary routing remains separate. Reuse the personal-agent availability predicate used by inline mode, not `ensureAgent`.

- [x] Write failing tests named `guest mention selects its author's existing agent`, `guest replies never inherit the quoted owner`, `compact guest events keep preview conventions without ordinary selectors`, and `guest numeric collisions grant no ordinary permissions`. Assert the 1,000-code-point preview limit, preserved attachment flags, native mention offsets after surrogate pairs, mixed-case username, native rich mention nodes and no activation from a mention found only inside quoted context.
- [x] Run `node --test test/integration/guest-events.test.mjs test/integration/guest-controller.test.mjs`; expect missing guest handling failures.
- [x] Subscribe to `guest_message`. Add a dedicated controller branch before ordinary chat saving/commands/triggers. Require a usable actual sender, native query ID and explicit own-bot mention in top-level text/caption entities or native `RichTextMention` nodes (`type:'mention'`, matching `username`) in the message's own rich body; do not scan reply/quote/reference messages or infer mentions from plain rich preview strings. Reject ambiguous sender-chat-only inputs. Resolve an existing enabled/authorized personal agent, save the complete message before enqueue, then enqueue `source:'guest'` with a fresh admission predicate. Do not wrap the request in an ordinary `message` event or create a group/private chat record from its destination.
- [x] Test no personal agent, disabled/stopping/revoked/deleted owner, master bot, unmentioned native/external replies, different-agent quoted widgets, two senders and two destinations in one model batch, new requests preserving older queued work, and repeated native updates not creating a second model event. Member-bot ordinary routing is unchanged. A known connected non-private member record may conservatively suppress matching guest IDs; never use it to route a guest message to that chat or merge namespaces. Check membership again before queue admission/effect when known; absence of a row is not proof of group access.
- [x] Run `node --test test/integration/guest-events.test.mjs test/integration/guest-controller.test.mjs test/integration/message-triggers.test.mjs test/integration/pollers.test.mjs test/integration/inline-controller.test.mjs`; expect all passed, including a fake polling assertion that `allowed_updates` contains `guest_message`.

## Task 3: Convert existing send bodies to one native guest result

**Files:** Create `src/guest/results.mjs`, `test/integration/guest-results.test.mjs`; modify `src/inline/results.mjs` only to share shape/input-content validation; preserve its existing default file-proof and photo-order behavior.

**Interfaces:** `prepareGuestResult(scope,body,{db,access,origin:'agent'|'widget'}) -> {native,definitions,snapshot}`. The origin is an internal trusted argument, never an agent-supplied field. Agent output keeps inline file-source proof; normalized widget output keeps existing inline-widget media trust rules. Reuse `prepareActionButtons` and existing native result validation rather than a second independent parser.

- [x] Write failing table-driven conversions covering all supported message fields, cached/URL variants where available, rich text, text entities/parse mode, captions, locations, venues, contacts and inline action rows/groups/permits. Assert `text -> article.input_message_content.message_text`, `rich_message -> article.input_message_content.rich_message`, no inserted marker/placeholder and no required agent-provided article ID/title.
- [x] Run `node --test test/integration/guest-results.test.mjs`; expect missing conversion failures.
- [x] Implement the mapping below. Synthesize internal result ID and display title where the agent did not supply one; native required envelope metadata is controller work. Keep authored content and prepared wire buttons in the confirmed snapshot.

| Existing content | Native transport / metadata rule |
| --- | --- |
| `text`, `rich_message` | Article with matching `InputMessageContent`; default envelope title `Response` |
| `photo` | Cached photo for file ID; URL photo uses its own URL as default thumbnail unless explicitly supplied |
| `animation` | Cached GIF/MPEG4 variant selected from available source MIME metadata; URL variant requires an unambiguous GIF/MP4 MIME choice and a public thumbnail |
| `video` | Cached video or supported URL MP4 with required thumbnail; default title `Video` |
| `audio`, `voice` | Cached or URL variant; default title `Audio`/`Voice`; retain existing cached-audio stored-title guidance |
| `document` | Cached document; URL document requires PDF/ZIP MIME metadata; default title `Document` |
| `sticker` | Cached sticker only |
| `location`, `venue`, `contact` | Matching native result from the same nested ordinary-send fields; use `Location` as an internal location title if needed |

- [x] Test missing native metadata, incompatible fields, multiple content kinds, `uploads`/`attach://`/local paths, token-bearing Telegram URLs, missing file-source proof for agent cached media, unsupported games/payment/ordinary send types/options and malformed buttons. No network effect on any conversion error. Do not download a remote file merely to infer missing MIME metadata. `origin:'widget'` must not become an agent-controlled bypass. Confirm scalar/native rich normalization follows existing `richInput` behavior.
- [x] Run `node --test test/integration/guest-results.test.mjs test/integration/inline-results.test.mjs test/integration/inline-media-all.test.mjs test/integration/inline-buttons.test.mjs test/integration/widget-media.test.mjs`; expect all passed, with existing inline ordering unchanged.

## Task 4: Publish guest responses, register ownership and recover receipts

**Files:** Create `src/guest/service.mjs`, `src/guest/receipts.mjs`, `test/integration/guest-service.test.mjs`, `test/integration/guest-recovery.test.mjs`; modify `src/controller.mjs`, `src/inline/store.mjs`, `src/inline/events.mjs` where integration requires it.

**Interfaces:** `createGuestService({store,inlineStore,telegram,assertCurrent,resolveActor,receipts,now})` exposes `read(scope,{guestRequestId})`, `send(scope,args)`, `publishPrepared(scope,{guestRequestId,prepared,viewId?}) -> {publicationId,inlineMessageId,message}`, `complete(publicationId)`, `recover()` and callback-registration settling. Normal send success remains publicly `{inlineMessageId}`. A view-aware internal publication remains journaled until Task 5 commits the binding.

- [x] Write failing tests: plain answer calls only `answerGuestQuery`; registration immediately enables owner-only inline read/edit; two concurrent calls both reach a permissive fake Telegram and save two distinct IDs; sequential fake rejection preserves native description and prior confirmed-answer evidence without rejecting locally.
- [x] Run `node --test test/integration/guest-service.test.mjs test/integration/guest-recovery.test.mjs`; expect missing service failures.
- [x] Resolve/authorize the stored request, prepare the result, and persist action definitions plus an independent publication attempt before effect. Write a per-publication durable receipt under the configured data directory, with no token. Revalidate current owner/role/availability immediately before `answerGuestQuery`. On success journal the exact returned ID, claim inline ownership, save the authored snapshot and complete the attempt locally. Do not mark the request consumed, suppress concurrent outgoing calls, or impose an exactly-once invariant.
- [x] Fault-inject each boundary: preparation/DB/receipt failure before send means zero API calls; API rejection retains its real error; lost response means `delivery_unknown` without retry; confirmed send plus failed registration returns `storage_failed` with the known inline ID. Recovery replays confirmed local registration only for the same valid owner, never the Telegram send or model invocation. Retain unresolved receipt evidence on DB failure; expire guest receipt files on the same original 30-day request deadline. Stop/delete/revocation must not cause recovery to recreate an agent or transfer ownership. Test a conflicting returned address never overwrites another owner's record.
- [x] Handle an inline callback arriving before publication registration: only for an unknown target, wait for the current bot's in-flight registration operations before attempting exact registry routing; acknowledge promptly using the existing callback behavior. This wait gates callback dispatch, not outgoing guest calls. Never associate a callback by timing, content or a guessed candidate. If no exact binding exists after settling, use the existing unknown-target behavior. Keep each successful publication's definitions/snapshot/owner independent; widget-bound callbacks must bypass the preparing model.
- [x] Run `node --test test/integration/guest-service.test.mjs test/integration/guest-recovery.test.mjs test/integration/inline-storage.test.mjs test/integration/inline-events.test.mjs test/integration/inline-messages.test.mjs test/integration/revoke-access.test.mjs`. Test restart recovery before accepting callbacks; ensure a rejected attempt does not invalidate another success, and no-answer/expired cleanup sends nothing.

## Task 5: Publish the first widget render directly as a guest answer

**Files:** Modify `src/widgets/manager.mjs`, `src/widgets/render.mjs`, `src/widgets/service.mjs`, `src/widgets/views.mjs`, `src/widgets/receipts.mjs`, `src/widgets/types.d.ts`; create `test/integration/guest-widget.test.mjs`; extend `test/integration/widget-receipts.test.mjs` and `test/integration/widget-view-render.test.mjs`.

**Interfaces:** Inject the guest publication service into the widget manager/renderer. `setView(scope,{widgetId,send:{guestRequestId},props?})` returns the existing `{viewId,target:{inlineMessageId}}`. A first-render `WidgetView.target` may be the frozen `{guestRequestId}` pending target; persisted live targets and callback events keep the existing ordinary/inline target union.

- [x] Write failing tests: first visible message equals the widget render and contains native widget callback data; no ordinary `sendMessage`, intermediate Wordle card or mandatory `editMessageText` occurs. Assert pending target/props are frozen, and later render/event snapshots use the confirmed inline ID.
- [x] Run `node --test test/integration/guest-widget.test.mjs`; expect guest envelope rejection before implementation.
- [x] Recognize the exclusive guest send envelope before ordinary default-chat resolution and authorization. Allocate a candidate view ID, render under existing widget locks/queue, normalize through existing JSX/rich/media preparation, reject uploads/unsupported initial types before effect, then call Task 4 with `origin:'widget'`. Authorize the personal widget owner without applying `assertWrite(undefined)` or treating the guest destination as the owner's private chat.
- [x] Commit the returned inline target, confirmed message projection, button names and view binding, then clear both relevant receipts. Later rendering, disabled controls, detach/delete, timers, error latches, state and owner conflicts follow the existing inline-view path. Extend candidate/receipt recovery to distinguish an unpublished guest destination from a real inline/ordinary target; no fake message ID, no repair send and no automatic attach if ownership is uncertain. Revalidate widget generation/owner before and after effect as existing lifecycle rules require.
- [x] Test first-render failure/onError, unsupported poll/media/local file output, confirmed answer followed by view-write failure, controller shutdown/revocation while publishing, a callback before binding, and later ordinary/inline rerenders. Two Telegram-accepted widget publications for one request must create separate views; a plain guest send and guest widget send may both succeed without overwriting ownership. Existing per-widget serialization is preserved, but is not a per-request answer lock.
- [x] Run `node --test test/integration/guest-widget.test.mjs test/integration/widget-receipts.test.mjs test/integration/widget-view-render.test.mjs test/integration/widget-views.test.mjs test/integration/widget-view-events.test.mjs test/integration/widget-view-errors.test.mjs test/integration/widget-controller.test.mjs`; expect all passed.

## Task 6: Wire controller tools and verify restart/lifecycle integration

**Files:** Modify `src/controller.mjs`, `src/widgets/service.mjs`; extend `test/integration/guest-controller.test.mjs`, `test/integration/guest-recovery.test.mjs`; create `test/integration/guest-read.test.mjs`. Ordinary `src/messages/actions.mjs` and `src/agents/history.mjs` remain the default routes; change them only if a shared validation fix is necessary and covered.

**Interfaces:** Route explicit guest `read`/`send` before ordinary read argument checks/default destinations. Construct guest storage/service early enough to inject it into widgets; recover local publication metadata and widgets before the controller's public readiness barrier permits callback handling. Reuse existing lifecycle scopes, queue holds and owner stop/delete behavior.

- [x] Write failing dispatch tests for the three mutually exclusive `read` modes, guest `send` interception, invalid mixed destinations, and guest handles after controller restart. Assert no fallback `sendMessage` to the personal user when guest validation fails.
- [x] Run `node --test test/integration/guest-controller.test.mjs test/integration/guest-read.test.mjs test/integration/guest-recovery.test.mjs`; expect missing dispatch/recovery failures.
- [x] Wire the service/read routes and readiness ordering. Full guest read uses only retained owner-scoped data and `readableDates`, without `history`/`search` pollution or ordinary group permission. Keep guest records through an explicit context reset, but recheck the actual current agent identity before sending; removed/recreated agents do not inherit old request handles. Expired requests fail silently except for the tool error to their caller.
- [x] Test paused/batched queues, preflight admission races, stop/revocation during preparation, context reset followed by an authorized explicit answer, no automatic model replay on restart, delayed background sends from retained requests, and ordinary inline cancellation not cancelling guest requests. Add tests that ending an unanswered model turn produces zero guest/private effects and actual publication-tool errors remain visible to the agent.
- [x] Run `node --test test/integration/guest-controller.test.mjs test/integration/guest-read.test.mjs test/integration/guest-recovery.test.mjs test/integration/inline-controller.test.mjs test/integration/inline-tools.test.mjs test/integration/history-access.test.mjs test/integration/clear-triggers.test.mjs`; expect all passed.

## Task 7: Expose schemas/instructions and publish accurate documentation

**Files:** Modify `src/codex/threads.mjs`, `src/widgets/contract.mjs`, `src/widgets/types.d.ts`, `test/integration/inline-tools.test.mjs`, `test/integration/widget-contract.test.mjs`; create `test/integration/guest-tools.test.mjs`. Add `docs/guest-mode.md`; update `docs/index.md`, `docs/agent-contract.md`, `docs/message-events.md`, `docs/messaging.md`, `docs/widgets.md`, `docs/agents.md`, `docs/storage.md`, `docs/security.md`, `docs/architecture.md`, `docs/operations.md`, and `docs/dev/index.md` in the implementation change.

- [x] Write schema/instruction assertions: `read` has three exclusive selectors; `send` exposes `guestRequestId`, supported body fields, buttons and needed native metadata; `set_widget_view.send` exposes the exclusive guest alternative. Invalid combinations are rejected by runtime even if the schema consumer is permissive.
- [x] Run `node --test test/integration/guest-tools.test.mjs test/integration/inline-tools.test.mjs test/integration/widget-contract.test.mjs`; expect missing schema/prompt assertions to fail.
- [x] Extend dynamic schemas for all planned guest bodies, including existing runtime `location`, `venue`, `contact`, caption fields and required media metadata; preserve ordinary content behavior. Keep the native dynamic-tool envelope and avoid introducing unsupported protocol-schema constructs. Prompts explicitly identify guest output as public, use `guestRequestId`, request at most one answer without claiming hard enforcement, permit silence and clarification, explain explicit mentions and buffers, and prohibit disclosure of unrelated private history/notes. Final model prose is still internal.
- [x] Document examples for plain/rich/media sends, optional/full read, direct unchanged widget publication, button activation, 30-day retention/restart, public-vs-private destinations, unsupported combinations, nonmember/member routing, repeated successes and real error ambiguity. Link official [answerGuestQuery](https://core.telegram.org/bots/api#answerguestquery) and [Guest Mode](https://core.telegram.org/api/bots/guest-mode); make no numerical answer-deadline or reliable Telegram exactly-once claim. Existing saved contexts can retain earlier developer instructions: document `/agent clear` as the explicit remedy, with no automatic context reset. Mark current behavior only after its code/tests exist; keep historical probe limitations in development evidence.
- [x] Run the focused tests above and `node docs/dev/check-wiki.mjs`. Resolve source/schema/examples/link discrepancies. Run `node test/manual/codex-tool-registration.mjs <configured-absolute-codex-executable>` when that runtime is available; expect the complete tool list to register without inference or Telegram sends. Record unavailable native-runtime checks honestly.

## Task 8: Automated gate, unchanged Wordle and bounded live acceptance

**Files:** Create `test/manual/guest-acceptance.mjs`, `test/integration/guest-acceptance.test.mjs`, `test/integration/guest-wordle.test.mjs`; reuse `test/helpers/wordle-fixture.mjs`, `test/manual/inline-fixtures.mjs` and existing Wordle migration controls. Update [guest verification](../guest-message-verification.md) with actual execution evidence only.

**Interfaces:** The manual runner takes explicit test configuration and a `--case` selector (`routing`, `media`, `widget`, `activation`, `restart`, `repeat`), uses the existing shared poller lock and effect budgets, verifies test bot identity/no active production controller, and binds permitted participants/routes from fresh marked input. No hardcoded tokens, raw personal IDs or unbounded polling. Each session lasts at most 10 minutes; each user-dependent stage stays active long enough for explicit confirmation rather than stopping widgets immediately after one click.

- [x] Write runner guard tests before live execution: ignore unrelated users/updates, no arbitrary ordinary send into a guest destination, edits only to confirmed scoped inline IDs, no deletion by a fabricated ordinary address, bounded sends/edits and stop/cleanup behavior. Never enable/disable/reset another live agent automatically. Fresh test contexts use only disposable data and explicit test enrollment.
- [x] Run `node --test test/integration/guest-acceptance.test.mjs`; expect guard tests passed before using a token. Then run focused guest/Wordle automated tests with `TG_WORDLE_ARCHIVE` pointing to the approved archive. `test/helpers/wordle-fixture.mjs` pins SHA-256 `f3279705d3873ed9588c6f2a88bf6e41a07ab4b8480865a4300238dc65a3d084`; missing archive means an explicitly unverified control, never substitute a rewritten game. Assert source hashes remain identical, first render accepts the pending guest view, callbacks keep `menu:start`/`key:*` and current turn-player rules.
- [x] Run the fresh full gate: `npm test`, `node docs/dev/check-wiki.mjs`, `git diff --check`. Expect zero failing tests; distinguish opt-in skipped checks from passing checks. Run the approved Wordle migration control too so additive schema/tool changes do not regress management of earlier widgets. On the established Alpine acceptance environment run the same relevant tests and widget sandbox/build checks through its existing identity-checked service workflow; do not invent a machine address or silently claim Windows validation as Alpine validation.
- [x] Live routing: fresh native mentions from A/B invoke their own actual test agents; a caller without an agent and guest replies without mentions stay silent; an explicit mention inside a reply to A invokes B. Verify independently sent requests in two destinations when those environments are available. Add the bot to a scoped group: enabled CHAT responds through the existing ordinary path; disabled/absent CHAT stays silent. Remove it after the member-phase test only when the runner recorded the test membership. Desktop/Android confirmations validate presentation, not backend ownership by themselves.
- [x] Live media: representative text, rich output, cached/public media, captions and prepared buttons through the production adapter, using quiet authorized buffers. Verify the mapped supported families and unsupported-before-effect errors. This is direct publication, not the earlier inline result-list layout matrix; do not repeat drum calibration or modify inline pagination. Record blocked/unavailable cases rather than substituting synthetic acceptance.
- [x] Live unchanged Wordle: use the real agent and new tools, explicit invocation -> direct `set_widget_view` -> first visible message already the game -> start and letter -> active timer/rerenders -> optional second owned view with synchronized state -> restart preserving binding. Keep views active until explicit completion or bounded session expiry. Separately test optional activation-card permits/action/owner routing and conversion. Compare original source hashes before/after. Warn the user immediately if unchanged Wordle exposes a compatibility issue; fix the framework, not the game source.
- [x] Live restart/repeat: confirm `read({guestRequestId})` and an explicitly requested later send remain possible after restart while Telegram still accepts the query; there is no automatic model rerun/send. Repeat the raw-query control through the implemented adapter, recording actual sequential/concurrent outcomes without assuming two successes must always recur. If Telegram accepts two, verify two independent owner/snapshot records and, for widget responses, separate view bindings. Do not label retained data as a 30-day Telegram response guarantee or run a 30-day wait.
- [x] Finish acceptance by stopping the runner, confirming lock release, disabling only probe-owned widget controls and cleaning only safely addressable probe-created buffers. Leave unknown-destination messages as evidence if no supported deletion route exists. Report automated/live/manual-unverified cases separately. No push/merge or production deployment is implied by this plan.

## Self-review and handoff

- [x] Map every accepted concept section to a task; deferred marker/reply routing remains absent.
- [x] Recheck store/service signatures across Tasks 1–6, the three read selectors, separate success records, and the pending-vs-confirmed widget target union.
- [x] Confirm no count/consumed guard was reintroduced through receipts, a uniqueness constraint, recovery or callback settling. Existing widget locks and inbound update idempotence do not enforce a per-request answer limit.
- [x] Confirm the five Review Focus cases have owning tests, native schema registration is covered, and model/Telegram live acceptance is separate from fakes.
- [x] Keep a task checkpoint list and verification receipts during execution. Commit checkpoints only after authorization; request help only for a real environment/user action or behavior conflict, not routine implementation choices.

Completion outcome: Tasks 1–8 completed within the accepted scope. Windows: 639 tests, 631 passed/eight skipped; Alpine: 639 tests, 636 passed/three skipped; no failures. Live explicit A/B selection, silence rules, ordinary CHAT routing, representative media, direct unchanged Wordle/restart, public one-shot activation, retained read/later answer and sequential/concurrent repeat controls passed. Optional or additional live cases remain explicitly unverified in the verification report. The Telegram answer lifetime remains undocumented; existing saved contexts may require an explicit instruction refresh. The user authorized commit, merge into main and push after validation; integration follows the recorded verification gates.
