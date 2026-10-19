# Ephemeral Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Hide supported group slash commands and controller replies, with compatible uploads and one-hour controller-owned attachment invitations.

**Architecture:** Register native ephemeral commands and add a command-scoped response transport. In-memory invitation records authorize attachment responses. Dispatch recognized ephemeral commands before the ordinary message pipeline and reject remaining ephemeral routes before history, widgets or model delivery.

**Tech Stack:** Existing Node.js ESM controller, native Telegram Bot API, SQLite unchanged, node:test.

**Spec:** [Accepted scope and verification](../ephemeral-command-verification.md#accepted-first-iteration-implementation-scope).

## Global Constraints

- Invitations are in memory, expire after one hour, close on first success, survive a failed attempt and do not survive restart.
- `/upload` and `/rules set` become available in groups with their existing admin requirement; other command restrictions remain.
- Ordinary private commands and existing document-first/command-first user-owned replies remain compatible.
- Defer agent API changes and ephemeral widget views. No ordinary message ID zero may reach history, a widget or an agent.
- English service output and maintained wiki; development material remains under `docs/dev/`.
- Use the existing isolated worktree. After successful acceptance, the user authorized committing the complete ephemeral-command and `/say` change and pushing it to `main`; preserve the original checkout's unrelated files.

## Review Focus

- Reused IDs, wrong bot/chat/topic/user, edited or fabricated invitations must not authorize a write (Task 3).
- A slow operation must complete privately after the initial 15-second reply window (Task 2).
- Concurrent uploads, write failure, permission revocation and confirmation failure must not duplicate a successful write (Task 3).
- Command responses must not turn newly published public widgets or other agents' output ephemeral (Tasks 2 and 4).
- Unmatched private replies, edited ephemeral input and callbacks must not enter group history or model/widget queues (Task 4).

---

### Task 1: Native command registration

**Files:** Create `src/commands/registration.mjs`, `test/integration/ephemeral-commands.test.mjs`; modify `src/main.mjs`.

**Interfaces:** `registerGroupCommands({telegram,botId})` installs the supported canonical command list with `is_ephemeral:true` in group and group-admin scopes. Master private commands are unchanged.

- [x] Write and run a failing test for command flags/scopes, canonical names and no master registration.
- [x] Implement registration and call it before starting each child poller, including newly registered bots; report registration failure without exposing secrets.
- [x] Run registration tests and existing command tests.

### Task 2: Command-scoped private responses

**Files:** Create `src/commands/replies.mjs`; modify `src/commands/router.mjs`, `src/commands/administrative.mjs`, `src/commands/files.mjs`; extend the focused tests.

**Interfaces:** A response session wraps the command's Telegram transport only, keeps the original actor and ephemeral target, and exposes a confirmed invitation-send operation. The file handler accepts an optional command transport for its document response.

- [x] Write RED tests for ordinary compatibility, private text/errors/chunks, slow completion, document replies, source deletion and no public fallback.
- [x] Schedule a private processing acknowledgement after 5 seconds without a response; edit it for delayed completion. Fast commands cancel the timer. Command-first attachment invitations never schedule processing and are confirmed standalone messages, so their source identity is immutable. Preserve multiple fast response chunks; make a late response-window failure explicit rather than silently publishing or dropping it.
- [x] Keep direct widget/runtime publication on its existing transport. Run affected command and file tests.

### Task 3: Controller-owned attachment invitations

**Files:** Create `src/commands/uploads.mjs`, `test/integration/ephemeral-uploads.test.mjs`; modify router/administrative hooks.

**Interfaces:** `createUploadInvitations({db,now})` registers confirmed invitation snapshots with parsed source command and supports scoped acquisition, successful consumption, failed-attempt release and clear. Router hooks register only a validated command and signal successful mutation before sending its completion acknowledgement.

- [x] Write RED tests for one-hour expiry, restart loss, role revocation, wrong scope/recipient/source, ID reuse, no parsing of bot text, one success, retry after failure and concurrent exclusion.
- [x] Re-execute the stored validated command with the current attachment and actor, preserving all normal access and path checks. Support ordinary bot invitations and both legacy user-owned upload reply directions.
- [x] Permit only `/upload` and `/rules set` in groups in addition to their existing private forms. Test both document and inline-pre rules forms, plus other commands remaining private-only.
- [x] Run focused upload/rules/argument tests.

### Task 4: Controller route isolation

**Files:** Modify `src/controller.mjs`; extend `test/integration/ephemeral-commands.test.mjs` and controller tests.

- [x] Write RED tests proving recognized ephemeral commands work and unmatched ephemeral messages, edits, callbacks and quoted ephemeral routes never reach ordinary history/widgets/agents/listening.
- [x] Dispatch command sessions before the ordinary pipeline; close pending sessions on controller shutdown and invalidate bot entries on removal. Preserve inline/guest/ordinary dispatch.
- [x] Run focused controller, callback, guest and widget regressions.

### Task 5: Documentation and automated verification

**Files:** Update `docs/commands.md`, `docs/operations.md`, `docs/security.md`, relevant `docs/dev/` verification and navigation.

- [x] Document registered commands, command-list refresh delay, private replies, upload scopes/lifecycle, missing reply context, restart loss and deferred APIs.
- [x] Run fresh full Windows and Alpine suites with the unchanged approved Wordle fixture, wiki validation and whitespace checks. Distinguish export/environment failures from product failures.
- [x] Request independent code review and resolve actionable findings before completion. Commit/push only after explicit user authorization.

### Task 6: Bounded Desktop acceptance

**Files:** Add a command-controller mode to a standalone opt-in manual harness; update `docs/dev/ephemeral-command-verification.md`.

- [x] Use only the observed test bot/group, bounded duration and exclusive bot lock; no model or production database.
- [x] Exercise actual ephemeral commands, errors, help, document-first upload, file reply to a registered invitation, rules upload and invitation consumption. Verify file bytes and native reply fields; keep source files private.
- [x] Restore command lists, remove only probe-created outputs, release the bot lock and record remaining untested conditions. One platform is sufficient by user decision.
