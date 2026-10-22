# Agent control: native and Telegram verification

This report describes bounded acceptance of the agent-control branch. The [automated verification report](agent-control-verification.md) separately records fixtures, regression tests and review. No production deployment or game migration was performed.

## Native runtime

| Environment | Runtime | Outcome |
|---|---|---|
| Windows development | Node 26.8.2, Codex CLI 0.159.3, Windows Job Object | Passed |
| Docker Desktop, Alpine 3.24.2, ordinary user | Node 24.18.1, Python 3.14.8, Codex CLI 0.159.3, Linux subreaper | Passed |

The probe is [test/manual/agent-control-native.mjs](../../test/manual/agent-control-native.mjs). It uses disposable bot storage and actual model inference, without Telegram polling or sends. Each successful platform run confirmed:

1. A root turn calls `context_status`; a subsequent snapshot has a measured usage estimate.
2. Native compaction reports a completed compaction item and matching completed turn. Exact `thread/read` reconciliation confirms the same identity.
3. Both root and native child actually start long shell commands and write independent heartbeat files.
4. Cancellation confirms owned process termination; both heartbeat counters remain unchanged during a further 1.3-second observation.
5. A new turn resumes the original saved thread without restarting either cancelled command.

Earlier unsuccessful probes were diagnostic evidence, not passes. Windows sampling returned unknown until ownership moved to a Job Object. The first Alpine container lacked namespace permissions, so Codex rejected thread creation. Another probe used a launcher symlink whose binary target was outside the filesystem grant; the final probe configured the actual native executable. The final disposable container used `--init`, `SYS_ADMIN`, and unconfined seccomp/AppArmor to allow Codex's own namespace sandbox. These are test-container settings, not changes to the host daemon or universal deployment recommendations.

An additional Linux process fixture reproduced a detached double-fork escaping 50 ms PPID polling and continuing to write after a false success. The replacement supervisor establishes `PR_SET_CHILD_SUBREAPER` before native startup and confirms success only after killing/reaping all children to `ECHILD`. The same fixture then passed. See [Linux subreapers](https://www.man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html) and [agent control](../agent-control.md) for operational requirements.

## Telegram client acceptance

The user performed real client actions against the designated `@dpohvar_test_pub_bot`, with a disposable controller/database and an observed test group. The runner is [test/manual/agent-control-telegram.mjs](../../test/manual/agent-control-telegram.mjs). It acquired the shared bot lock, checked the bot identity and webhook state, and bounded polling, sends and lifetime.

| Case | Evidence |
|---|---|
| Context status and manual compaction | User confirmed expected replies; native turns and compaction completed |
| Cancel long root and child commands | Both commands started; cancellation confirmed, saved thread retained, ten waiting fixture items retained |
| Correction after cancel | The real next user message resumed the queue and the model followed the correction |
| Compact with continuation | One intermediate compute turn and one resumed turn; expected continuation output observed |
| Grouped button eviction | Actual user callback was evicted by synthetic queue fillers; readback showed restored callback data; user pressed it again successfully |
| Private `/say` eviction | Actual private command preparation was evicted by synthetic fillers; exactly one private error edit was observed; user confirmed the expected queue-removal text |

The user reported checks 1–6 behaving as expected and confirmed the queue-removal message in the final `/say` case. The runner recorded no errors. Queue fillers were deliberately synthetic; this is not a claim that eleven independent Telegram messages were manually sent. Wake-source permutations, continuous arrivals, uncertain edits and crash boundaries are covered by automated tests rather than this client session.

## Cleanup and limits

The runner stopped cleanly. All six backed-up command scopes/languages were restored and independently read back, temporary test messages were cleaned up, polling settings were restored, and the bot lock was released. Temporary roles lived only in the disposable database. Native test processes and disposable Docker containers were stopped after collecting evidence; the user's Docker service and existing images were preserved.

These checks establish the observed native/client scenarios, not arbitrary-version compatibility, a real Telegram restart at every crash boundary, or exactly-once ordinary effects. Recovery fault tests use durable database reconstruction and fake native evidence; they must not be described as live Telegram crash acceptance. Real game canon, chapter closure and `joan-moreno` files were not changed.
