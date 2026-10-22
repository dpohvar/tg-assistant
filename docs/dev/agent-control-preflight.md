# Agent control testing preflight

Date: 2026-10-23. Branch: `feat/agent-control`, application base `9fd0fd9`.

This is a test-environment and existing-behavior check, not acceptance of the proposed cancellation or context-management features. See the [implementation plan](plans/2026-10-23-agent-control.md).

## Executed checks

- Loaded the existing private test configuration without printing or copying its token.
- Telegram `getMe` confirmed the designated `dpohvar_test_pub_bot` identity, including its configured numeric ID.
- Telegram `getWebhookInfo` confirmed no active webhook. The local configuration declares `controllerActive: false`; this declaration does not prove that no other process is polling. No polling was started, updates consumed, messages sent or bot settings changed.
- Installed the locked dependencies in the isolated worktree with `npm ci --ignore-scripts --no-audit --no-fund`. Initial queue/wiki attempts had failed because dependencies were absent; both checks succeeded after installation.
- `node --test test/integration/queue-batching.test.mjs`: 7 passed, 0 failed. This verifies the current fixed 200 ms batching implementation, including its existing rejection on overflow. It does not test the proposed eviction policy.
- `node docs/dev/check-wiki.mjs`: passed; 20 wiki articles, 592 local links, 18 JSON examples and 55 controller tools checked before adding this report.

Environment: Windows, Node.js `v26.8.2`. No Codex inference or native control acceptance was performed. The full integration suite was not run.

## Remaining acceptance

The new commands, persistent control coordinator, eviction rollback and compaction continuation are still planned. Their tests must be implemented alongside the features. The existing designated bot can be used for bounded Telegram acceptance with separate disposable storage and the shared exclusive bot lock, once no other test runner owns it.

Before native acceptance, establish that interruption stops owned child commands without deleting the saved thread, and that native completion evidence can reconcile compaction and continuation submission after a crash. An unavailable result remains unknown, as required by the design.

No maintained wiki behavior changed; only development documentation was updated.
