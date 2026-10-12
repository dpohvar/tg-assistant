# Widget runtime memory-limit investigation

Design experiment, 2026-10-12. No production widget runtime has been implemented. The accepted quotas are now 10 widgets per agent runtime, 10 agent-widget runtimes per bot and 256 MiB per runtime. Sandbox helpers do not consume extra logical runtime slots. There is no server-wide quota.

## Compared mechanisms

| Mechanism | Scope | Suitability |
|---|---|---|
| Node `--max-old-space-size` | V8 old generation | Useful secondary limit, not a total-memory cap; excludes Buffer/native allocations and children |
| External OS memory monitor | Measured process or tracked process tree | Portable, no cgroup delegation required; kills runtime after observing excess, but sampling permits overshoot and child tracking must be correct |
| Windows Job Object `JOB_OBJECT_LIMIT_JOB_MEMORY` | Committed memory of processes in the job | Kernel-enforced allocation restriction, child accounting and termination capability; native helper needed, allocation denial does not inherently stop every process |
| Linux cgroup v2 `memory.max` | Charged memory of group and descendants | Kernel-enforced group limit; use `memory.swap.max=0`, group OOM policy and external lifecycle handling; requires delegated/writable cgroup management |
| Docker `--memory` | Whole container cgroup | Convenient cgroup configuration; a shared application container limit is not an individual runtime limit |
| Linux RLIMIT_AS / RLIMIT_RSS | Per-process virtual address space / historical RSS limit | Not a good portable resident-memory cap for V8: address-space reservation differs from committed/resident usage; Linux RSS rlimit does not provide the needed modern enforcement |

Windows job committed memory and Linux cgroup charged memory are not identical RSS metrics. cgroup accounting also includes charged cache/kernel memory; some kernel operations can temporarily exceed `memory.max`. Job aggregate includes Codex runner overhead if attached around the runner. Do not promise an exact cross-platform 256 MiB RSS boundary.

## Live probes

The [bounded allocation probe](../../test/manual/widget-memory-limit-probe.mjs) retains up to 320 MiB of touched Buffer data in 8 MiB chunks, 50 ms apart. It also provides a demonstration external RSS monitor. The [Windows Job probe](../../test/manual/widget-windows-job-memory-probe.ps1) creates a dedicated job, applies a configurable limit plus kill-on-close, assigns only a test process and queries applied flags and peak accounting. Tests accessed no real secrets and made no Telegram calls.

| Probe | Windows Node v26.8.2 | Alpine Node v24.18.1 |
|---|---|---|
| `--max-old-space-size=64`, buffers to 320 MiB | Completed; RSS 375.6 MiB, heap used about 3.8 MiB | Completed; RSS 367.4 MiB, heap used about 3.6 MiB |
| External RSS monitor, threshold 128 MiB | Killed; highest observed RSS 175.2 MiB | Killed; highest observed RSS 135.7 MiB |
| Job Object, 128 MiB committed limit | Allocation failed after retaining 104 MiB; exit 2; queried flags 8704, peak job commit 132.5 MiB | Not applicable |
| Job around actual Codex MXC runner, 256 MiB | Sandbox Node allocation failed after retaining 200 MiB; payload exit 2; peak job commit 256.9 MiB | Not applicable |
| Separate Docker container, 256 MiB memory and swap total | Not applicable | Kernel OOM; `OOMKilled:true`, exit 137; last logged retained buffers 224 MiB |

The monitor prototype delays 100 ms between samples. Windows measurement additionally launches PowerShell, so effective sampling latency is higher; its result is not a benchmark of an optimized native monitor. An allocation burst between samples can exceed the threshold by much more than observed here. The monitor reads external OS RSS, not an agent-controlled `process.memoryUsage()` result. This prototype tracks only one child process, not a general sandbox process tree.

The Windows job probe deliberately delays allocation for assignment; a production launcher must avoid the startup assignment race by suspended creation or an equivalent enforced launch handshake. An initial probe had a PowerShell value-type field-assignment mistake: the job did not receive the intended flags. The corrected probe verifies the actual configured limit/flags and produced the rejection results above. Those corrected measurements are the evidence, not the initial unrestricted run. Small peak overshoots are reported rather than treating the configured value as an exact observed byte ceiling.

The MXC test used the already verified strict fixture filesystem profile, `prefer_mxc`, explicit package scope and preserve-symlinks flags. A Node wrapper and Codex runner were placed in a 256 MiB job. The nested sandbox payload's allocation was also constrained. This verifies this host/version combination with the test payload; arbitrary child/native allocation patterns, completion-port event handling and production integration are not complete. Allocation failure was caught by the test script; the controller still needs to explicitly deactivate widgets and stop the whole runtime when limit pressure/failure is detected, even if user code catches an allocation error.

The Alpine test created a temporary container from the prepared test image with `--memory 256m --memory-swap 256m --pids-limit 32`, copied only the bounded probe and inspected OOM status after execution. The temporary container was removed. The existing application service/container was not restarted or reconfigured. Its `/sys/fs/cgroup` is mounted read-only and its current `memory.max` is `max`. No attempt was made to remount/delegate it. A Docker whole-container OOM proves cgroup enforcement, not a complete per-runtime delegated cgroup setup or group-wide OOM behavior with multiple children.

## Recommendation awaiting approval

Use a controller-side monitor and a secondary V8 heap limit for a deployment requiring no extra host configuration. Clearly label this as a monitored threshold, not a hard cap. Prefer OS enforcement where supported: a dedicated Windows job or a delegated Linux cgroup per agent-widget runtime, with the controller outside that group. Linux hard enforcement may require a one-time operator deployment setup; a read-only Docker cgroup mount cannot be treated as per-runtime delegation. A limit on the entire shared app container would risk terminating the controller and unrelated agents.

Do not silently select an unlimited fallback if a requested strict backend cannot be applied. Strict/monitored startup policy, monitoring metric/interval, heap limit and exact accounting of runner overhead remain design choices. Killing a runtime follows the agreed widget shutdown policy, preserves only saved state, disables buttons best effort and notifies its owner without automatic restart.

Raw local outputs remain in ignored `.runtime-check/widget-memory-{heap,monitor,job}-*.json*`; the special MXC wrapper is an ignored probe. No server files or product modules were changed. Check syntax, documentation links and diffs before committing these development artifacts.

## Primary references

- [Node heap CLI limits](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib)
- [Windows Job memory fields](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
- [Windows jobs, nesting and lifecycle](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Linux cgroup v2 memory controller](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [Linux resource limits manual](https://man7.org/linux/man-pages/man2/getrlimit.2.html)
