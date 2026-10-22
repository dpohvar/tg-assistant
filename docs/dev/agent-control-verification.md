# Agent control verification

Implemented in the isolated `feat/agent-control` worktree from base `9fd0fd9`. This report records acceptance before integration. Subsequent commit/merge/push authorization and integration are recorded by the Git history; no production deployment was performed. The [combined plan](plans/2026-10-23-agent-control.md), [cancellation design](agent-cancel-design.md), [context design](context-management-design.md) and [current contract](../agent-control.md) describe the scope.

## Automated checks

The unchanged Windows baseline had 800 passing tests, 10 skips and no failures. The final complete integration suite is run with four concurrent files to avoid timing contention in the shared Windows/Docker test environment:

```sh
node --test --test-concurrency=4 test/integration/*.test.mjs
node docs/dev/check-wiki.mjs
git diff --check
git diff --cached --check
```

| Environment | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Windows, Node 26.8.2 | 844 | 0 | 11 |
| Alpine 3.24.2, ordinary user, Node 24.18.1 | 849 | 0 | 6 |

The Alpine source copy uses normal Linux LF endings, separate Linux dependencies installed from the lockfile, and no Windows `node_modules`. Initial root/CRLF runs exposed environment failures in permission-denial acceptance and the executable Git helper. The corrected run uses an ordinary user. Optional native browser/Poppler and archived Wordle checks remain skipped where their opt-in assets/environment are absent; Windows additionally skips Linux-only checks.

New suites cover queue boundaries and source quotas, durable controls/work, immutable native turn correlation, root-only context metrics, cancel and retained admissions, compaction/continuation, recovery and process termination, grouped-button restoration, and private eviction effects. Existing scheduler, permissions, history, command, widget, inline, guest, media and storage tests remain in the full gate. Disk-reopen tests cover ambiguous native submission/running/unknown boundaries without replay. Native/client results are separately recorded in [native verification](agent-control-native-verification.md).

## Independent review and fixes

One fresh reviewer examined the whole scoped branch against both designs and all five Review Focus items. The review found seven Important issues, no Critical issues and no Minor issues. All seven entered one fix pass with failing regression evidence before implementation changes:

| Finding | Resulting behavior and regression |
|---|---|
| Receipt identity collides after restart | Queue items use UUIDs; reconstructed queues cannot reuse durable callback IDs (`queue-control`) |
| Prepared callback and expired-steer eviction races | Unstarted close is cancelled safely; confirmed consumption follows steer acceptance; delayed ACK still closes consumed buttons (`button-rollback`, `queue-control`) |
| Failed compaction recovery keeps continuation pending | Definite recovery failure cancels continuation, settles work and permits another explicit request (`agent-control-recovery`) |
| Scheduler retries a running uncertain continuation | All unresolved continuation-owned processing firings stay protected from recovery replay (`agent-control-recovery`) |
| Root terminal mistaken for whole-work completion | Recovery checks all persisted owned identities; child creation is recorded before its turn ID exists and ACKs are deduplicated (`agent-control-recovery`, `agent-control-storage`, `agent-work`) |
| Linux PPID snapshots miss detached descendants | Subreaper supervisor kills and reaps owned descendants, including double-forked commands; missing ownership stays unknown (`agent-cancel-native`) |
| Migrated receipts keep old JSON addresses | Canonical receipt columns take precedence; embedded control/work/reply routes are rewritten during chat migration (`button-rollback`) |

No findings were deferred as minor. The reviewer deliberately did not judge credentials/live native execution, which were handled by the parent without logging secrets, or general durable inbox/outbox/exactly-once effects, which remain outside scope. No second review was substituted for the regression and complete-suite gates.

## Implementation rulings

1. Reuse the newly created isolated worktree rather than create another identical one. Isolation is preserved; no additional risk or dependency.
2. Windows uses an unnamed Job Object assigned before initialization, with kill-on-close and accounting, because RSS/PPID sampling could not confirm native termination. Cost: an available .NET Framework compiler is required; missing ownership prevents model startup. The initial Linux sampling choice was superseded by ruling 7.
3. Preserve synchronous RAM reservation visibility during admission callbacks, but evict only after successful durable commit. Cost: admission commits must stay synchronous.
4. Cancel fences immutable work/turn identities rather than invalidating the source Lifecycle generation. A failing regression showed the latter discarded retained `/say` admissions. Cost: mutating controller paths must continue to enforce current-work checks.
5. Ordinary durable inbox/outbox and exactly-once effects remain outside scope. Control intent is durable; the ordinary queue is RAM-only and can be lost on a crash.
6. Native acceptance and credential handling remain the parent's responsibility rather than the reviewer's. Cost: the bounded live matrix is explicit and does not certify unexecuted scenarios.
7. Linux uses a Python child-subreaper supervisor rather than sampled PPIDs. Cost: `python3` and `/proc` become runtime requirements; unsupported supervision fails closed. Existing widget monitoring is unchanged.
8. The uncommitted scoped index diff against the recorded base is the review input, and the execution ledger is retained until integration. Cost: review evidence stays local while commits are unauthorized.

The shared message serialization is applied at controller edit/delete/widget-takeover entry points rather than changing the existing message-action API. Startup control recovery uses the existing `controller.ready` ordering before scheduler recovery/polling. No automatic compaction percentage was added; policy belongs to the owner's `AGENTS.md`.
