# Widget Node memory comparison

Design experiment, 2026-10-12. Widgets are not implemented. This probe compares runtime overhead, not production capacity or sandbox enforcement.

## Method

Run [the manual probe](../../test/manual/widget-memory-benchmark.mjs):

```sh
node --expose-gc test/manual/widget-memory-benchmark.mjs > result.json
```

Three repetitions of each configuration; fresh hosts, explicit initial GC, sample after 1.6 seconds. Each simulated widget retains a 32 KiB text state and a one-second timer that changes a counter and serializes state. The second workload additionally allocates and touches an 8 MiB Buffer per widget. No actual Telegram calls, WebSocket connection, third-party package or JSX compiler runs. All variants load the same probe imports. Separate-process totals exclude the benchmark orchestrator; the Worker variant includes its host process and all workers. Workers run the same file with a separate JS engine, not an extra benchmark orchestrator. Shared mode stores all widgets in one event loop.

Windows uses Node v26.8.2 x64. Alpine uses Node v24.18.1 x64 in the existing Docker test container. The sandbox/Codex runner is excluded from all variants. The existing bot service was not stopped. These are different Node versions, so compare architectures within each platform, not platform performance directly.

Windows `PrivateMemorySize64` measures private committed memory, not just resident RAM. Alpine `/proc/PID/smaps_rollup` PSS measures resident memory with shared pages apportioned among processes. PSS depends on other processes sharing those pages. Summed RSS counts shared library pages repeatedly and exaggerates separate-process cost. Both RSS and the more useful platform-specific metric are recorded below. Units: MiB, median of three runs.

## Results: platform-specific memory metric

| Workload | Windows private commit: processes | Windows: workers | Windows: shared loop | Alpine PSS: processes | Alpine: workers | Alpine: shared loop |
|---|---:|---:|---:|---:|---:|---:|
| 1 simple widget | 21.8 | 42.8 | 21.8 | 26.1 | 41.5 | 26.2 |
| 5 simple widgets | 109.7 | 120.1 | 22.0 | 94.4 | 89.7 | 26.4 |
| 1 widget + 8 MiB buffer | 29.8 | 50.4 | 30.1 | 34.2 | 49.5 | 34.2 |
| 5 widgets + 8 MiB each | 149.6 | 160.1 | 62.5 | 134.4 | 129.5 | 66.5 |

Empty host baseline: Windows private commit 21.9 MiB; Alpine PSS 26.2 MiB. Repetitions were stable: for five simple widgets, Windows private commit ranges were 109.3–110.0 / 118.8–120.4 / 21.9–22.5 MiB; Alpine PSS 94.3–94.5 / 89.5–90.5 / 26.4–26.5 MiB.

## Results: RSS / working set

| Workload | Windows processes | Windows workers | Windows shared loop | Alpine processes | Alpine workers | Alpine shared loop |
|---|---:|---:|---:|---:|---:|---:|
| 1 simple widget | 58.8 | 75.1 | 58.8 | 51.9 | 70.1 | 52.1 |
| 5 simple widgets | 294.1 | 130.2 | 58.9 | 259.7 | 118.0 | 52.0 |
| 1 widget + 8 MiB buffer | 66.7 | 82.8 | 66.9 | 59.9 | 77.9 | 59.8 |
| 5 widgets + 8 MiB each | 333.9 | 170.1 | 99.1 | 299.6 | 158.0 | 92.3 |

## Interpretation and limits

Workers dramatically reduce summed RSS, but this does not demonstrate equivalent savings of physical RAM. For five simple widgets, Alpine PSS saves about 5% compared to separate processes; Windows private commit is about 9% higher. A shared loop saves about 72% Alpine PSS and 80% Windows private commit. Buffer-heavy shared mode still saves about 51% and 58% respectively; buffers themselves remain allocated in every architecture.

For these workloads, Workers are primarily a way to isolate execution and terminate individual JS engines, not a compelling memory optimization. A shared event loop gives the largest measured saving but cannot independently interrupt a synchronous infinite loop in one widget. It also removes the process-based per-widget memory and termination boundary. Adoption requires an explicit change to those earlier requirements; this report does not approve that change.

The small workload and initial GC make this an overhead comparison. Real dependency graphs, renderers, connection buffers, native allocations, GC cycles and long-term load can change the totals. Sandbox-wrapper overhead and OS-enforced limits require a separate experiment before deployment claims. Raw local samples are retained in ignored `.runtime-check/widget-memory-windows.json` and `.runtime-check/widget-memory-alpine.json`; the reproducible probe and medians are documented here.
