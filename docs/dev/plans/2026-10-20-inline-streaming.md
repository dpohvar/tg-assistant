# Incremental inline results implementation plan

> **For agentic workers:** Use superpowers:executing-plans for native implementation. Track steps below; a fresh reviewer checks the final diff.

**Goal:** Deliver agent inline results incrementally while preserving old single-call usage.

**Architecture:** Keep the existing RAM request and cursor store, append validated items, and distinguish closed input from drained delivery. Cache one response per cursor and serialize page allocation within a request. Continue existing normalization and action registry at their current boundaries.

**Tech Stack:** Node.js ESM, node:test, SQLite button registry, Telegram Bot API.

**Spec:** [Accepted design](../inline-streaming-design.md).

## Global constraints

- `done` is optional boolean, default true; no batchId/status fields.
- Keep triggerMs=2000, waitMs=5000 and promptRows=[6,6,20]. Original TTL is one hour; requests and portions remain RAM-only.
- English controller copy; retain user-authored status content. No public fallbacks or silent buffer uploads.
- Work only in feat/inline-streaming; no commit/push or live sends before preparing the bounded acceptance case.

## Review focus

1. Concurrent/repeated cursor requests must not allocate two pages or duplicate button records.
2. Portions/completion arriving during awaited registry work must not prematurely terminate delivery.
3. Photo-to-text transitions and native articles must not be misclassified as friendly status cards.
4. Invalid final portions, wrong owners and replaced requests must have no partial append/registry effects.
5. Empty completion after earlier delivery must end pagination without Work complete or a hung waiter.

## Task 1: Streaming store and page delivery

Files: src/inline/{requests,service,results}.mjs; test/helpers/inline-fixture.mjs; test/integration/inline-{streaming,service,results,controller}.test.mjs.

- [x] Add failing behavioral tests for append/wakeup/completion, atomic validation, arrows at delivery, fresh wire IDs, homogeneous photo pages, cursor replay and concurrent registry work.
- [x] Run focused tests and confirm failures describe missing streaming/replay behavior.
- [x] Extend setReady(owner,id,prepared,done=true) and service.setResults(scope,{requestId,results,done=true}); validate done before mutation, keep normalization atomic and append portion order.
- [x] Mark friendly omitted-message statuses in normalized internal records. Generate fresh wire IDs in service at acceptance; never regenerate on replay.
- [x] Serialize cursor processing and cache exact successful page responses; compute continuation/arrows after asynchronous registration; abort on close and recheck ownership before send.
- [x] Update tests that intentionally depended on consuming an old cursor again to use the actual continuation or assert replay.
- [x] Run focused tests and full npm test; inspect all failures.

## Task 2: Agent contract, documentation and live fixture

Files: src/codex/threads.mjs; docs/{inline,agent-contract}.md; docs/dev/index.md; test/manual/inline-streaming.mjs; test/integration/inline-streaming-probe.test.mjs.

- [x] Expose done:boolean in the actual dynamic tool schema; update instructions for append/final semantics and arrow-free status cards.
- [x] Update canonical wiki, add incremental example and link design/verification notes from the development index.
- [x] Prepare bounded native Telegram fixture with three distinct photos, real controller and timed deterministic portions. Reuse designated test bot lock and owner-only buffers; do not run or claim live acceptance yet.
- [x] Verify fixture timing/cleanup safeguards offline and provide explicit commands for later user acceptance.
- [x] Run full suite, wiki checker and git diff --check; request independent review and resolve material findings with regression tests.
- [x] Report implemented behavior, evidence and live cases still pending. Keep worktree and audit files.
