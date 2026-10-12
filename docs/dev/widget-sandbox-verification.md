# Widget sandbox probe — 2026-10-12

This is a live feasibility probe for the proposed widget runner, not an implementation or security certification of widgets. Only disposable synthetic files were used; no real server credentials, database content, or private conversations were read. Existing bot services were not restarted.

## Environments

| Environment | Versions | Outcome |
| --- | --- | --- |
| Native Windows, legacy backends | Codex CLI 0.159.3 | Strict read restrictions refused before Node started |
| Native Windows, MXC follow-up | Windows build 28120.3181 (26H1), Node v26.8.2, Codex CLI 0.159.3 | 21/21 checks passed through both standalone sandbox and a real agent command; process-tree termination passed |
| Alpine Docker container | Alpine 3.24.2, Node v24.18.1, Codex CLI 0.159.3, Linux kernel 6.18.54.1-microsoft-standard-WSL2 | 21/21 access/runtime checks passed; process-tree termination probe passed |

The Alpine checks ran as the existing non-root `probe` user in `tg-assistant-alpine-check`. A separate fixture tree was created outside its application workspace.

## Runner and profile

The host launched `codex sandbox -P widget-probe` with explicit filesystem and network overrides. The profile used minimal runtime reads, writable synthetic bot workspace and own temp, denied `.git` and other agents' temp, and readable Node/Codex executable directories. Network was enabled. The host launcher removed environment keys matching TOKEN/SECRET/PASSWORD/API_KEY, including a synthetic secret marker.

An initial Alpine attempt omitted the resolved Codex executable directory and failed with `bwrap: execvp /opt/codex/bin/codex: No such file or directory`. Adding read access to that runtime directory enabled startup without granting access to synthetic server/neighbor files.

## Alpine results

All 21 checks passed:

- Bot workspace read/write and own temp write.
- Read/write refusal for other-agent temp, neighboring bot, synthetic server config/database/session files, and `.git`.
- A child Node process could not read the neighboring bot fixture.
- An imported local synthetic npm package executing a file-read attempt was subject to the same denial.
- A symlink inside the allowed workspace did not expose the neighboring bot fixture.
- The synthetic environment secret marker and matching secret-variable names were absent.
- Timer execution and HTTPS fetch to example.com worked.

Most hidden paths returned ENOENT; `.git` returned EACCES. All protected fixture files existed outside the sandbox and remained unchanged after the probe. ENOENT is expected when the sandbox does not expose a path, rather than evidence that the host fixture was missing.

A separate live process-tree test started a parent, an ordinary child, and a child using `detached:true`, each writing a heartbeat every 100 ms. Killing the runner's dedicated process group stopped all three heartbeats and exited the wrapper. Children also had a bounded self-exit as cleanup protection. This proves the tested Linux launcher/termination combination, not a completed widget stop implementation.

## Windows initial results: legacy backends

Both native attempts refused startup and left protected fixtures unchanged:

- Default/elevated: `windows sandbox failed: elevated Windows sandbox requires effective :root read access`.
- Explicit unelevated: `windows sandbox failed: Restricted read-only access requires the elevated Windows sandbox backend`.

No unrestricted fallback was used. Granting root read access would not satisfy the intended confidentiality boundary. These initial results apply to the legacy backends, not the later successful MXC probe below.

## Windows follow-up: working MXC configuration

The user requested two directions: invoking Node through the real agent tool and investigating Windows/Codex configuration. Both were exercised, without changing installed Codex or global configuration.

### Agent without MXC

A separate app-server session used the same restricted permission profile. It refused `thread/start` before a model turn or Node command:

`failed to prepare windows sandbox wrapper: windows elevated sandbox cannot reopen writable descendants under read-only carveouts directly; refusing to run unsandboxed`

This exposed another limitation of the legacy backend: denying the shared temp directory while reopening the caller's own temp. Using an agent did not bypass it.

### Enable MXC

The installed 0.159.3 CLI exposes `prefer_mxc`. Passing `--enable prefer_mxc` enabled the working backend on this host. No CLI upgrade, administrator provisioning, global configuration change, Windows feature installation, or full-disk read grant was needed.

Equivalent opt-in configuration in the relevant service `CODEX_HOME/config.toml` is:

```toml
[features]
prefer_mxc = true
```

This preference can fall back on incompatible systems; it must be combined with the strict filesystem profile and refusal to start when that profile cannot be enforced. Availability on another Windows machine is not established by this host's success. See official [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox).

### Node module loading

The first MXC Node invocation failed because the loader tried to resolve ancestors outside its readable roots (`lstat C:\\`, EPERM). The probe passed these flags without widening filesystem permissions:

```text
node --preserve-symlinks --preserve-symlinks-main probe.mjs
```

An explicit package.json in the permitted synthetic workspace (`type: module`) and the synthetic package (`type: commonjs`) prevented package-scope lookup outside the workspace. Without the explicit scope, package import failed with ERR_INVALID_PACKAGE_CONFIG.

With these loader settings, standalone MXC passed the same 21 checks: own workspace/temp, forbidden read/write fixtures, npm package and child-process denial, junction/symlink denial, sanitized environment marker, timers and HTTPS. All protected fixtures remained unchanged.

A real separate Codex thread, with `permissions: widget-probe`, MXC enabled, and approval policy never, then executed that exact Node probe through its native shell tool. The command's 21 checks also passed and the turn completed. No Telegram tools were supplied or messages sent. The temporary thread was deleted afterward.

### Background process and lifecycle

- Explicit termination of the standalone runner tree stopped the parent, ordinary child and detached child heartbeats.
- When the standalone foreground Node exited naturally, MXC stopped both child heartbeats, including `detached:true`.
- A real agent command invoked a Node launcher that spawned a detached/unref child. Its output confirmed `BACKGROUND_STARTED=true` and a heartbeat file existed, but its heartbeat no longer advanced after the shell command/turn completed. Subsequent thread deletion and app-server shutdown found it already stopped; this does not separately establish clear behavior for a still-running widget.
- A preliminary PowerShell Start-Process attempt returned an unknown process-start error inside MXC. PowerShell's overall exit code was zero despite that error; the probe did not treat that as a successful child launch.

Consequently, the user's suggested fire-and-forget launch does not maintain a persistent widget under this verified MXC setup. Keep the sandbox's foreground runtime alive and supervise it from the controller, independently of model turns. This matches the official documented child cleanup at command exit.

## Evidence and limitations

Ignored experiment artifacts are under `.runtime-check/`: `widget-sandbox-probe.mjs`, `widget-sandbox-lifecycle.mjs`, `widget-agent-launch-probe.mjs`, Windows fixture `result.json` files, `widget-agent-launch-result.json`, `widget-agent-launch-mxc-result.json`, and copied Alpine access/lifecycle JSON results. These are temporary probes, not production modules or committed regression tests.

- The npm test used a locally authored package, not downloaded packages, native addons, or installation scripts.
- The environment test covered a marker and the stated filtering policy; it does not prove arbitrary secret names cannot leak. A production runner should use a deliberately constructed environment.
- CPU/memory/process quotas, RPC authorization, SDK compilation, full widget persistence, file-descriptor inheritance and additional escape techniques remain untested.
- Network was intentionally allowed; this does not establish a localhost/private-network filter.
- The result depends on the tested Codex version, kernel, container configuration and launcher. The positive native Windows result specifically requires the working MXC backend and tested loader/profile setup. Arbitrary npm dependencies may still perform unsupported filesystem lookups; native addons/install scripts remain untested.

Recommendation: use the verified Alpine sandbox command and Windows MXC command as runner candidates. Keep each widget runtime as the sandbox foreground process, supervised by the controller. Refuse widget startup on platforms where the required read/write boundaries cannot be enforced. Do not treat a plain Node spawn, cwd, or Node vm as equivalent isolation.
