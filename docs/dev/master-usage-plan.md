# Master-bot usage implementation plan

**Goal:** compare reported token and image usage across child bots from the master bot.
**Architecture:** SQLite schema 12 stores Telegram identities, UTC aggregate buckets and durable per-thread baselines. Codex notifications update baselines and buckets atomically; master reports are parsed from replies without a snapshot table.
**Spec:** [Accepted decisions and probes](usage-counters-verification.md).
**Execution:** inline executing-plans and TDD; one final independent review. Merge/push authorized after tests.

## Constraints and review focus

- Master-only `/usage`, English output; no new agent tools.
- Preserve schema 11 data, unrelated React discussion and primary checkout files.
- Retain removed bot totals by Telegram ID, including repeat registration.
- Resume replay, child notifications and duplicate image events must not double count.
- First observation of existing sessions seeds a baseline, without importing historical expense.
- Parse only intact master reports with exact IDs/counters; handle truncation and resets.
- Calendar UTC retention; late data must not resurrect expired buckets.

## Tasks

- [x] Storage RED/GREEN: migration 12, transactional counters, image dedup, identity preservation, retention and reopen/rollback tests.
- [x] Reports RED/GREEN: commands, comparisons, formatting, strict parsing, permissions, whole-block truncation and help.
- [x] Adapter RED/GREEN: root/child usage, resume baseline, image file size and session cleanup; Windows suite.
- [x] English master/storage/architecture wiki, Alpine suite and isolated live adapter smoke.
- [ ] Independent branch review, fixes and final verification; commit intended changes and fast-forward/push main.

## Ledger

- Reuse isolated worktree, branch `feature/master-usage`, base `6a14b57`.
- Ruling: per-bot aggregates only; no agent/model breakdown in this release, matching approved scope.

- Independent review identified reset-baseline suppression and reused-child cleanup hazards. Both were reproduced with failing tests, corrected and verified.
- Reset values are rebased only after an observed new native turn; stale decreases are ignored. Image dedup records expire after seven days without updates.
- Final checks and live evidence: [verification report](master-usage-verification.md). Integration is authorized and will fast-forward remote main after the implementation commit.
