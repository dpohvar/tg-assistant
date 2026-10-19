# Hidden `/say` Agent Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute inline, with one independent review after the full change.

**Goal:** Deliver authorized hidden group messages to the existing chat agent, with a prepared private response that can be read, edited or deleted later.

**Architecture:** Store ephemeral snapshots separately from ordinary history with a 30-day TTL and agent ownership. A `/say` handler validates role and chat availability, prepares a private response, then uses the ordinary chat queue. Agent tools explicitly select ephemeral addresses; native ID zero never enters ordinary history or selectors.

**Tech Stack:** Existing ESM controller, SQLite migration 18, node:test, native Telegram API.

**Spec:** [Accepted design](../ephemeral-command-verification.md#say-accepted-next-iteration-design).

## Global constraints and implementation decisions

- `/say` requires application role user or higher, including groups. No priority, extra capacity, new session, agent enablement or public listening window.
- Event: ordinary `message`, stripped text with adjusted entities, `triggers:["/say"]`, incoming `ephemeralMessageId`, optional confirmed `preparedReply:{ephemeralMessageId,receiverUserId}`. No redundant ephemeral boolean or ordinary ID zero.
- Send `Request received.` immediately; preparation failure still delivers the event with a preparation error. No automatic public fallback or uncertain-send retry.
- Keep snapshots in SQLite for 30 days under the originating bot/chat/agent; exclude them from ordinary history/search. `read({ephemeralMessageId})` selects incoming messages; receiverUserId selects outgoing ones. Prepared-response addresses survive controller restart.
- Internal identity checks quarantine known reused native addresses instead of overwriting a prior generation. Deleted/uncertain responses cannot be edited as known existing responses. Local availability never guarantees Telegram visibility.
- This command is for native ephemeral group/supergroup input. Reject ordinary cached group commands explicitly rather than promising privacy; private chats already have direct messaging. This does not change existing commands' ordinary compatibility.
- Extend native private send/read/edit/delete only. Polls, dice, albums, ephemeral widgets and interactive ephemeral buttons remain unsupported with explicit errors; ordinary functionality remains intact. Agent instructions describe hidden correspondence with the common chat agent, without elevated instruction authority.
- Keep the existing isolated worktree and include the prior ephemeral-command iteration. After successful acceptance, the user authorized committing the combined change and pushing it to `main`; preserve the original checkout's unrelated files.

## Review focus

- Cross-agent/user/bot addresses and mixed ordinary/inline/guest/ephemeral selectors must fail before an external effect (Tasks 1/2).
- Full queue, role revocation and shutdown during preparation must not create extra queue capacity or late events (Task 3).
- Duplicate/reused native IDs and unknown send/edit outcomes must not repeat publication or change a different generation (Tasks 1/2/3).
- Full-text reads, formatting and forum topics must preserve the source context without exposing hidden messages through ordinary history (Tasks 1/3).
- Private-only agent failures must not produce a public controller error notice (Task 3).

### Task 1: Persistent ephemeral snapshots

**Files:** `src/storage/migrations/018.sql`, `src/storage/database.mjs`, `src/ephemeral/store.mjs`, `src/storage/retention.mjs`, `test/integration/say-ephemeral.test.mjs`.

**Interface:** `createEphemeralStore(db,{now}).record(scope,message,{direction,signature?})`, `get(scope,address)`, `update(scope,address,fields)`, `markUnknown`, `markDeleted`, `setEventState`, `markQueued`, `cleanup`.

- [x] RED: persistence/reopen, 30-day expiry, foreign owner/address denial, deleted/unknown targets, reused-ID quarantine and cascade.
- [x] Implement migration and store; preserve the ordinary message schema and retention behavior.
- [x] GREEN: focused store and existing database/retention tests.

### Task 2: Agent ephemeral message tools

**Files:** `src/ephemeral/messages.mjs`, shared file validation in `src/messages/actions.mjs`, tool routing in `src/controller.mjs`, `src/codex/threads.mjs` schemas, focused tests.

**Interface:** `createEphemeralMessages({db,store,telegram,access,assertCurrent,uploads}).read/send/edit/delete(scope,args)`.

- [x] RED: edit/delete prepared replies after 15 seconds, incoming reads, explicit native private send, implicit recipient for native ephemeral replies, native errors/unknown delivery, ownership and selector validation, uploaded media, unsupported private content.
- [x] Implement explicit routes and schema alternatives, preserving normal send/edit/read/delete. Never return or persist an ordinary message ID zero.
- [x] GREEN: focused tools, ordinary messaging, inline/guest and dynamic schema regressions.

### Task 3: `/say` queue integration and instructions

**Files:** `src/ephemeral/events.mjs`, `src/controller.mjs`, `src/commands/router.mjs`, `src/commands/registration.mjs`, `src/commands/help.mjs`, `src/codex/threads.mjs`.

- [x] RED: user role, disabled/unknown chat, native-hidden-only, stripped text/entities/truncation/read, confirmed preparation and failure event, same chat queue/capacity/steer, duplicate updates, no listening/history, role changes/shutdown, private failure notification suppression.
- [x] Implement the handler before generic command formatting; use ordinary queue source `chat`, existing lifecycle/gate and safe shutdown. Register/help `/say`; teach the agent edit/delete, privacy, authority and error silence.
- [x] GREEN: controller and existing command/event/queue tests.

### Task 4: Documentation, full checks and review

**Files:** `docs/commands.md`, `docs/message-events.md`, `docs/messaging.md`, `docs/agent-contract.md`, `docs/agents.md`, `docs/security.md`, development report and navigation.

- [x] Update current API/event/retention examples and scope limits; distinguish accepted design, implementation and live evidence.
- [x] Run full Windows and Alpine suites with the unchanged Wordle fixture, wiki validation and diff checks.
- [x] Independent review of the full change; reproduce and fix actionable findings, then rerun necessary checks.

### Task 5: Bounded live Desktop acceptance

**Files:** `test/manual/say-ephemeral-acceptance.mjs`, development report.

- [x] Reuse the observed test bot/group with exclusive lock and disposable DB; no production data or automatic group leave.
- [x] Use actual controller queue and tools to exercise prepared reply editing after the initial window, public output plus deletion, normal user access, full reads and restart persistence; formatting is verified with exact automated entity assertions. Use a deterministic agent for mechanics; keep any real-model acceptance separately identified.
- [x] Restore command lists with read-back, delete only probe-created output, release lock and record limitations. Desktop alone is sufficient.
