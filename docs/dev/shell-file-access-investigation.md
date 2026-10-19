# Alpine shell failures mistaken for inaccessible files

Investigation and implementation date: 2026-10-19. Source baseline: `286d068`. The operator approved disabling shell snapshots after the investigation. The application launch override is implemented and verified below; no remote deployment was performed.

## Finding and scope

The reported combination—exit code 2, empty output, successful reading after `login:false`—was reproduced through the real `CodexAgent` adapter with Codex 0.162.1 on Alpine under root. A syscall trace established that the failing process never reached the requested file-reading command. It failed while sourcing a Codex shell snapshot that existed outside the sandbox but was not mounted inside it.

This is a confirmed cause of the reproduced failure. The remote deployment has no configured SSH access, and its original scheduler/model trace was not collected. The supplied Telegram messages are agents' accounts of the incident; reproducing their symptom does not independently establish the complete history of that particular morning's run.

The runtime facts supplied by the operator are Alpine, Codex 0.162.1, and launching the service as root with the existing `service:alpine_start` command. No remote configuration, service, game, schedule, or Telegram message was modified.

## Failure mechanism

1. At the investigation baseline, [the application](../../src/codex/threads.mjs) started a native Codex App Server with the named `tg-agent` filesystem profile. It permitted the bot workspace, the agent's own temp and minimal runtime files, but excluded controller state and Codex authentication/session storage. It did not explicitly configure `allow_login_shell` or `features.shell_snapshot`.
2. Codex permits login-shell semantics by default. With a shell snapshot available, a matching login command is rewritten approximately as follows:

   ```sh
   # Requested:
   /bin/sh -lc 'printf BODY_STARTED; cat game.json'

   # Relevant part of the actual wrapper:
   /bin/sh -c '
   if . "SNAPSHOT_PATH" >/dev/null 2>&1; then :; fi
   exec /bin/sh -c "printf BODY_STARTED; cat game.json"
   '
   ```

   The real wrapper also preserves selected runtime environment variables. This abbreviated example shows the failing operation, not the entire generated command.
3. Snapshots live under `CODEX_HOME/shell_snapshots`, outside the permitted bot workspace. In Codex 0.162.1 the internal additional snapshot read permission is gated by an active credential broker. The project's ordinary network-enabled profile does not itself enable that broker. In the traced run, the sandbox's bind mounts did not include the snapshot.
4. The wrapper's `open(SNAPSHOT_PATH, O_RDONLY...)` returned `ENOENT` inside the sandbox. The controller-side snapshot had been successfully created, validated, and retained before the command; a copy also parsed successfully with both sh and Bash. This was a visibility problem, not a missing game file or invalid snapshot syntax.
5. BusyBox ash, exposed as `/bin/sh`, terminates a noninteractive shell with status 2 when the `.` special builtin cannot open the file. Wrapping it in `if` does not make this failure recoverable. Codex redirects both output streams of that operation to `/dev/null`, hiding the reason.
6. Consequently neither `BODY_STARTED` nor `cat game.json` executes. The agent sees only code 2 with no output and may incorrectly conclude that game state is unavailable.

Selecting `shell:"/bin/bash"` in an individual tool call did not fix the root-account case: Codex still ran the snapshot prelude through the session's `/bin/sh`, before executing the requested Bash command.

Root privileges are not the direct cause. In the test container the root account's login shell was ash, whereas the preexisting `probe` account used Bash. Codex selects the default user shell through the account record; setting the `SHELL` environment variable alone did not change this selection. Bash continued past the failed sourcing operation in the comparison fixture, which explains why the original non-root tests did not expose the failure. Changing service accounts is not the proposed repair.

## Experiments and results

All data was synthetic. The test file contained `{"synthetic":true,"players":12}`; commands printed `BODY_STARTED` before attempting to read it. No Telegram sends, scheduler actions, application subagents, or real game changes were allowed. Native sessions were deleted after observation.

Environment: existing Alpine 3.24.2 test container, Node 24.18.1, project `CodexAgent`, unchanged `tg-agent` permissions. The official Codex 0.162.1 musl binary and its matching code-mode helper were installed in a separate diagnostic directory; the existing 0.159.3 installation was not replaced. Download digests were checked against official release metadata. Initial raw-binary attempts missing the separate helper ran no shell commands and are not counted as shell experiments.

| Experiment | Result |
|---|---|
| Plain sh/Bash `-c` and `-lc`, outside and inside the named sandbox | All eight combinations read the file successfully |
| Native Codex 0.159.3, existing non-root Bash account | Four requested sh/Bash × login on/off commands succeeded |
| Native Codex 0.162.1, same non-root Bash account | Four commands succeeded; the login-shell symptom did not reproduce |
| Native Codex 0.162.1, root account with ash | sh login=true: 2/empty; sh login=false: 0/file; Bash login=true: 2/empty; Bash login=false: 0/file |
| Same failing root fixture under syscall tracing, repeated | Same four outcomes; two snapshot opens returned `ENOENT`; the failed processes never opened `game.json` |
| Minimal snapshot wrapper, snapshot outside allowed roots | ash: 2/empty; Bash: 0/file |
| Same minimal wrapper, grant read to that synthetic snapshot only | Both shells: 0/file |
| Root native fixture, only `features.shell_snapshot=false` changed | All four sh/Bash × login on/off commands succeeded |
| Root native fixture, only `allow_login_shell=false` changed | Omitted login and explicit login=false both read the file; explicit login=true was rejected before execution with a clear validation error |

The last two checks changed only separate diagnostic Codex configurations. They did not enlarge filesystem permissions. No full application suite was rerun because runtime implementation was not changed; these are focused native reproduction and mitigation checks, not a production deployment acceptance.

## Remedy selection

The operator selected the targeted snapshot-disable option. The alternatives considered were:

- **Targeted option: disable shell snapshots** in the App Server launch overrides, for example `-c features.shell_snapshot=false`. The root fixture then handled both ordinary and login commands successfully. This removes the inaccessible snapshot prelude while retaining native shell startup semantics. It does not grant access to private Codex storage.
- **Alternative: disallow login-shell semantics** with `-c allow_login_shell=false`. Omitted `login` then defaults to false, and explicit true receives the validation error `login shell is disabled by config; omit login or set it to false.` This was also checked natively. It changes the tool contract and therefore needs matching agent instructions and compatibility checks for expected PATH/tool availability.
- A short agent instruction should distinguish a failed shell startup from a confirmed file error. A read-only probe may be retried with `login:false`; never blindly repeat a command with possible writes, sends or other external effects. Do not recreate/reset game state merely because an earlier shell command returned empty output.

Do not fix this by exposing all of `CODEX_HOME`, disabling the OS sandbox, copying authentication into a bot workspace, or applying broad chmod changes. Granting the synthetic snapshot alone was a diagnostic control, not a proposal to share real session snapshots among agents.

The upstream wrapper and missing non-broker snapshot mount are suitable material for an upstream issue; no issue was published during this investigation.

## Implemented change and final verification

`CodexAgent.createSession` now adds `-c features.shell_snapshot=false` to the normal App Server launch, before MCP configuration preflight. This applies to both new and resumed model threads and overrides an inherited user setting of true. Login-shell configuration, environment filtering, network configuration and filesystem grants are unchanged. No service JSON or global Codex configuration changes are required. A controller restart is required to replace existing App Server processes; context clearing is not required for this launch-only change. The current operational contract is documented in [operations](../operations.md) and [security](../security.md).

Verification:

- Two new start/resume launch regressions failed before the change and passed afterward. The focused Codex integration suite passed all 20 tests.
- Native [shell-snapshot regression probe](../../test/live/shell-snapshots.mjs) ran on Alpine 3.24.2 under root/ash, using a separate private test Codex home with `features.shell_snapshot=true`. The actual App Server configuration resolved to false through the production launch override.
- Both Codex 0.162.1 and the existing 0.159.3 installation passed eight checks each: sh/Bash, login true/false, new/resumed thread. The resumed phase reused the same saved native thread after closing the first App Server.
- In every native combination, the shared bot workspace and own temp allowed both reads and writes. Other-agent temp, `.git`, a neighboring bot and controller data denied both. Probe source remained unchanged; no Telegram actions or model subagents were used.
- Review found a probe-only cleanup ordering issue. The final probe now deletes its native thread before closing the final agent and surfaces cleanup failures. The corrected probe was rerun successfully on 0.162.1; earlier diagnostic threads were explicitly deleted as well.
- Full Windows suite: 641 tests, 633 passed, 8 skipped, 0 failed. Full Alpine suite: 641 tests, 638 passed, 3 skipped, 0 failed. The approved unchanged Wordle archive was enabled in both suites.
- The initial Alpine suite hit an unrelated export issue: Windows `core.autocrlf=true` converted the executable Git askpass helper to CRLF in the Git archive, although the committed blob is LF. Normalizing only that exported test copy restored the Git authentication check; the full suite then passed. The tracked helper was not modified.
- Wiki links/examples and `git diff --check` passed. Production code review reported no Critical or Important findings.

The tests exercise real Codex and the kernel sandbox in the local Alpine container. The remote installation itself was not accessed or restarted.

## Why it looks intermittent

The file itself need not change. Model-selected `login:false` bypasses this snapshot path, while default/true can take it. A different session account shell, availability/timing of snapshot creation, and a changed working directory can also change whether the wrapper runs. Snapshot wrapping is conditional in upstream code. The account-shell and login-setting differences were measured here; the contribution of timing or cwd to the remote incident remains unverified.

The scheduler and widget runtime are distinct boundaries. The supplied account says the schedule fired and the model then abandoned its work. The reproduced bug is in native model shell execution; the [widget sandbox launcher](../../src/widgets/sandbox.mjs) directly executes Node and does not use this model shell prelude. No evidence here establishes a widget renderer failure or an independent scheduler defect.

## Primary references

- [Codex 0.162.1 shell wrapper](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/tools/runtimes/mod.rs): `maybe_wrap_shell_lc_with_snapshot`, suppressed sourcing, and wrapper-shell selection.
- [Codex 0.162.1 unified execution](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/tools/runtimes/unified_exec.rs): broker-gated `snapshot_permissions`.
- [Codex 0.162.1 shell detection](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/shell-command/src/shell_detect.rs): account-based `default_user_shell` selection.
- [Codex configuration reference](https://developers.openai.com/codex/config-reference/): `allow_login_shell` defaults and behavior.
- [Codex 0.162.1 release](https://github.com/openai/codex/releases/tag/rust-v0.162.1): isolated musl binary/helper used in the reproduction.

This development report preserves the diagnosis and verification evidence. The maintained wiki describes the implemented launch policy.
