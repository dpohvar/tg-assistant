# Operations

[Wiki home](index.md) · [Architecture](architecture.md) · [Commands](commands.md) · [Master bot](master-bot.md)

Run the controller as a dedicated ordinary Linux user. The supported deployment workflow uses Alpine over SSH. Node.js must be at least **24.18.1**; the validated Codex CLI is **0.159.3**, with a native executable for the host architecture and musl. Startup executes `codex --version`: a different version produces a warning and continues with an unvalidated runtime; a failed version command prevents startup. Upgrading Codex requires fresh runtime and filesystem isolation checks.

## Install on Alpine over SSH

An administrator installs system dependencies. Ensure the Alpine repositories supply the required Node version; do not assume the distribution default satisfies the engine requirement.

```sh
apk add --no-cache git nodejs npm ripgrep tzdata ca-certificates curl chromium poppler-utils font-dejavu ffmpeg
```

`nohup` must also be available (BusyBox or coreutils). Install Codex separately, for example under `/opt/codex/bin`, and verify:

```sh
node --version
npm --version
/opt/codex/bin/codex --version
command -v nohup
chromium --version
pdftotext -v
ffmpeg -version
ffprobe -version
```

Then, as the service user:

```sh
git clone https://github.com/dpohvar/tg-assistant.git
cd tg-assistant
npm ci
npm test
umask 077
mkdir -p "$HOME/tg-assistant-data/control/secrets" "$HOME/tg-assistant-data/wiki" "$HOME/tg-assistant-data/codex-home"
cp config.example.json config.json
```

Use the current reviewed application revision. The npm dependencies include `playwright-core`; it uses system Chromium rather than downloading a browser. PDF reading requires Poppler. Set `TG_CHROMIUM_PATH` if Chromium is installed at a nonstandard path. Chromium runs headless as the ordinary user with its own sandbox enabled; GPU/X11 is not required. The host must allow the namespaces needed by the browser and Codex sandboxes. See [Agent contract](agent-contract.md) and [Security](security.md).

### Sticker and custom emoji dependencies

Static sticker/emoji files can be viewed natively after download. Animated inspection uses system tools available to the agent shell: FFmpeg/ffprobe for WebM, and `lottie_to_png` for TGS after gzip decompression to Lottie JSON. Alpine's BusyBox supplies `gzip`. These dependencies are needed for inspecting motion, not for receiving messages or downloading files. Startup does not install or probe these tools; a missing renderer should be reported when inspection is requested.

Install the pinned [lottie-converter v1.2.0 release](https://github.com/ed-asriyan/lottie-converter/releases/tag/v1.2.0) as root. The Linux executable is statically linked and does not need Python, Chromium or a separate rlottie package for PNG output:

```sh
apk add --no-cache ca-certificates curl unzip ffmpeg

case "$(uname -m)" in
  x86_64) lottie_arch=amd64 ;;
  aarch64) lottie_arch=arm64 ;;
  *) echo "Unsupported architecture"; exit 1 ;;
esac

lottie_tmp="$(mktemp -d)"
curl -fL \
  "https://github.com/ed-asriyan/lottie-converter/releases/download/v1.2.0/lottie-converter.linux.${lottie_arch}.zip" \
  -o "$lottie_tmp/converter.zip"
unzip -q "$lottie_tmp/converter.zip" -d "$lottie_tmp"
install -m 0755 "$lottie_tmp/bin/lottie_to_png" /usr/local/bin/lottie_to_png
```

Bake these steps into the container image for persistent installations; interactive changes disappear when the container is replaced. Confirm `ffmpeg`, `ffprobe`, `gzip` and `lottie_to_png` are on the service user's `PATH` and usable from an agent's shell, not only from a root session. The binary expects uncompressed JSON; downloads may be extensionless, so decompress TGS based on its format rather than its filename. Store intermediate JSON and PNG frames in the calling agent's own `.temp/AGENT_ID/` directory. See the [inspection workflow](agent-contract.md#inspecting-stickers-and-custom-emoji).

The release includes x86-64 and ARM64 Linux binaries. PNG frame output does not require a GIF encoder. Deployment verification evidence is recorded in the [development investigation](dev/sticker-custom-emoji-plan.md#implementation-verification), separately from these installation instructions.

## Configuration and authentication

Child-bot startup and registration install ephemeral group command lists automatically; no configuration flag or agent context reset is required. Registration failure logs `command_registration_failed` and leaves ordinary command handling available. Client command caches can update later. Restart loses outstanding in-memory upload invitations; ask for a new `/upload` or `/rules set` invitation. See [command behavior](commands.md#ephemeral-group-commands).

Enable Guest Mode for the desired child bot through BotFather and verify `getMe.supports_guest_queries` before testing mentions outside member chats. The controller subscribes to `guest_message`; there is no new guest configuration block or automatic personal-agent creation. Upgrade applies the additive schema-17 migration and preserves existing widgets. Restart retains guest request handles and local publication receipts, without replaying unanswered model work. Existing Codex contexts can keep old developer instructions; use explicit `/agent clear` where an instruction refresh is required. No context reset is automatic. See [Guest Mode](guest-mode.md) for supported output and live-check limits.

Edit `config.json`, starting from [config.example.json](../config.example.json):

| Setting | Meaning |
|---|---|
| `serviceOwnerId` | Positive Telegram user ID allowed to operate the master |
| `dataDir` | Absolute controller directory; SQLite, locks, secrets, rules and logs |
| `botsDir` | Absolute parent of the individual bot wiki directories |
| `codexHome` | Absolute private Codex authentication/session home |
| `codexExecutable` | Absolute path to the Codex executable |
| `masterTokenFile` | Absolute path to a file containing the master token |
| `defaultTimezone` | Valid timezone, default `UTC` if omitted |
| `defaultModel` | Initial model default for registered bots, default `gpt-6.1-sol` |

JSON does not expand `$HOME`; write resolved absolute paths. `dataDir`, `codexHome` and `masterTokenFile` must be outside `botsDir`. The executable's containing directory must not contain any of those paths or `botsDir`, because the agent receives read access to that directory. Keep executable binaries in their own directory. Do not place secrets, config or authentication data in the wiki/Git tree. Give the service user access and restrict private directories/files (typically directories 700 and token/config files 600).

Write the master token as one line into `masterTokenFile` using an editor, then authenticate as the same ordinary user and with the configured Codex home:

```sh
CODEX_HOME="$HOME/tg-assistant-data/codex-home" /opt/codex/bin/codex login --device-auth
```

The intended setup uses a ChatGPT account authorized through Codex. Authentication and sessions are private controller data, not bot wiki content. Register child bots through [Master bot](master-bot.md); configure their rules through [Commands](commands.md). For custom TLS roots, provide `NODE_EXTRA_CA_CERTS` when starting Node; do not disable certificate validation. [WebSocket](websocket.md) and [MCP](mcp.md) need no separate service. HTTP MCP runs through the native Codex App Server; their stored settings and headers are part of the private database.

## Service commands

From the application directory and as the service user:

```sh
npm run service:alpine_start
npm run service:alpine_status
npm run service:alpine_stop
```

Each reads `config.json` by default. An explicit config path is accepted:

```sh
npm run service:alpine_start -- /srv/tg-assistant/config.json
npm run service:alpine_status -- /srv/tg-assistant/config.json
npm run service:alpine_stop -- /srv/tg-assistant/config.json
```

These control the entire process: master and all children. Start uses `nohup`, a detached process group, closed stdin, and append-only output to `dataDir/service.log`. The application ignores `SIGHUP`; it can continue after SSH disconnects. Start waits up to 60 seconds for `controller.ready` matching the lock's PID/nonce. Readiness means controller initialization and poller startup, not proof of successful model/tool actions. Repeated start returns existing state. Status reports `running`, `starting` or `stopped`, PID when present, and log path.

Stop verifies `/proc` identity: user, Node executable, entrypoint, config path, lock identity and process birth time. It sends `SIGTERM` and waits up to 60 seconds, without automatic `SIGKILL`. A readiness timeout may leave an initializing process alive: inspect status/log and stop it if needed. Concurrent start/stop commands use `service-command.lock`. `nohup` supplies neither boot-time autostart nor crash recovery; arrange a process manager separately if needed, using the same user, config and runtime environment.

For foreground use or an external process manager:

```sh
node src/main.mjs /srv/tg-assistant/config.json
```

`npm start -- CONFIG_FILE` is also available. Alpine service commands reject Windows; Windows development does not exercise Linux file-descriptor path protections or production sandbox behavior.

## Validation and operational probes

Run `npm test` after installation/upgrade. With system Chromium and Poppler available, also run:

```sh
TG_READERS_NATIVE=1 npm test
```

Without this variable, three native-reader integration tests are skipped. Offline/fake-provider tests do not prove Telegram access, Codex authentication, or kernel sandbox support. Before production on a new host or after a Codex upgrade, repeat a bounded live check with the real `tg-agent` profile: confirm permitted wiki/own-temp access and denial of controller/auth/secret files, other bots, and another agent's temp. Do not replace the profile with unrestricted access to make a failed probe pass. Check a real Telegram send and a native Codex turn; inspect external action results rather than treating a completed turn as acceptance. The contract is in [Agent contract](agent-contract.md), [Messaging](messaging.md), and [Security](security.md).

Shell network access is enabled while filesystem isolation remains enforced. `browser_read` has its own public-address restriction; this does not constrain arbitrary shell networking. Native reader checks should include a JavaScript page and PDF text/rendering. A Docker success does not establish support on a different host kernel. See [Agent contract](agent-contract.md) for reader bounds and challenge/error behavior.

## Locks, shutdown and retention

Only one controller may use the database. `controller.lock` contains a PID and unique nonce. A dead PID permits guarded recovery. If `controller.lock.reclaim` remains after a crash, verify that no relevant controller/recovery process is running, then remove only that stale guard. Do not delete an active lock to start another process.

`SIGINT`/`SIGTERM` stop new activations, revoke scopes and close Codex processes. Database closure waits for pollers (including dynamically added children), in-flight controller work and cleanup. The RAM queue is not persisted. Schedules and registered generated-image sources survive; unfinished tasks may repeat external actions after recovery. See [Message events](message-events.md) and [Scheduler](scheduler.md).

Daily cleanup retains message history for 30 days, inter-agent messages for seven days, and `.temp` files for 24 hours by mtime. Notes/tasks are not deleted when message history expires. Registered image sources are cleaned through their registry, not arbitrary paths. Cleanup errors are reported to the bot owner; `/temp cleanup` retries only expired temporary-file cleanup. WebSocket connections do not survive restart; their separate binary temporary directory is cleared at controller startup. See [Storage](storage.md) and [WebSocket](websocket.md).

## Backups and restoration

For a straightforward filesystem backup, stop the service and confirm the process/database are closed. Save the entire controller directory (including SQLite, secrets, rules and registered image sources), bot wiki/Git directories and Codex home. A live SQLite backup must use SQLite backup facilities rather than copying an active WAL database file alone. Backups contain credentials, MCP headers, unencrypted vault values and private conversations; protect them as private service data.

Restore only while stopped, with the same directory layout and permissions. If absolute paths change, verify stored file paths, credential references and native sessions before live operation. Restart and inspect status/logs, then run bounded operational probes. To rotate a Telegram token, stop, replace the corresponding secret file, and restart. Git setup can discard local wiki changes and unpushed commits; back up first when they must be retained.

## Application and runtime upgrades

The controller explicitly disables Codex shell snapshots for model sessions, including resumed threads. This avoids an Alpine ash startup failure when a snapshot under private `CODEX_HOME` is unavailable inside the agent sandbox. Login-shell semantics remain available; normal shell startup files and the inherited service environment determine tool availability. No additional service JSON or global Codex configuration is needed. Restart the controller after upgrading so existing Codex processes receive this launch policy; clearing agent context is not required for this policy change. Filesystem permissions remain unchanged. See the [investigation](dev/shell-file-access-investigation.md) for reproduction details.

1. Stop the service, confirm shutdown, and take a recoverable backup.
2. Update to the reviewed code revision and run `npm ci` and `npm test`; run native reader tests where their dependencies are installed.
3. Start using the same config and inspect status/logs. Database migrations run automatically in a transaction before Telegram events are accepted.
4. After instruction or tool-contract changes, use Admin `/agent clear *` in each child bot, or clear selected agents. Clear waits for current work and retains queued input, history, notes, files and tasks. A resumed native session alone is not a replacement for resetting stale instructions.
5. Complete bounded live runtime/tool probes appropriate to the upgrade.

The current schema is **16**. Migration records prevent reapplying completed migrations; a database newer than the controller supports is rejected. Do not delete/recreate the database to resolve migration failure: diagnose the cause and retry. Old code must not open the upgraded database. Return to old code only with its pre-upgrade database/files backup; there is no in-place reverse migration. For details see [Storage](storage.md). `/rules set` clears contexts itself; MCP set/delete waits for current work and refreshes the App Server while preserving context, so those changes do not require a manual clear.

Keep logs private. Do not publish raw RPC payloads, base64 image results, token-bearing Telegram URLs or unsanitized shell/Codex logs; those can contain vault credentials. For the permissions and secret boundaries, see [Security](security.md). Runtime version warnings indicate unvalidated compatibility, not successful production acceptance.

### Diagnosing agent failures

`agent_failed` is followed by a JSON diagnostic object containing only allowed machine fields. `stage` distinguishes MCP preflight, initialization, bot profile lookup, thread start/resume and turn start/wait. Depending on the failure, `rpcMethod`, numeric `rpcCode`, `codexErrorInfo`, HTTP status, OS error code, process exit code/signal and a fixed `reason` category identify the failing boundary. Unknown free-text errors remain unclassified; messages, prompts, request arguments, provider details, raw stderr and credentials are never included in this diagnostic line. For example:

```text
agent_failed {"code":"agent_failed","stage":"turn_wait","codexErrorInfo":"httpConnectionFailed","httpStatusCode":401}
```

A version warning alone does not establish the cause. Check the deployed Git revision and obtain a new diagnostic line after a test message. `service:alpine_start` is idempotent: it does not reload an already running process after `git pull`. Use explicit `service:alpine_stop` followed by `service:alpine_start` with the same config, confirm the new PID, and retry. Repeated context clearing does not fix provider, process or protocol errors.

`mcp_preflight` runs even without registered MCP servers. `mcp_config_failed` with a process exit can mean Codex itself failed to load its configuration. An `unknown configuration field` error is categorized as `invalid_configuration`: the controller starts Codex with `--strict-config`, so unsupported fields prevent startup. Back up the dedicated Codex configuration and remove the specifically named incompatible field, preserving authentication and other settings. For example, Codex 0.162.1 rejects `tui.daemon_auto_start`; removing that assignment, whether inside `[tui]` or written as a dotted key, restores configuration loading. The controller does not automatically edit private Codex configuration or disable strict validation.

## Widget runtime operations

[Widgets](widgets.md) require the strict Codex OS sandbox, Node, and the pinned esbuild package installed by `npm ci`. Alpine needs no extra memory-monitor package; Windows uses the available .NET Framework C# compiler for a persistent process monitor. Startup fails closed when the sandbox/monitor is unavailable. Controller-owned snapshots live under `dataDir/widgets/BOT_ID/AGENT_ID`; include them in backups with SQLite and bot files. Unreferenced compiled snapshots are collected at startup and shutdown. Normal shutdown preserves active registrations for restoration; watchdog/memory/heartbeat failure stops all widgets in that owner runtime, purges their queues and requires explicit update_widget repair. Windows model sessions and widget runtimes request the MXC backend with strict filesystem restrictions; failure to enforce them refuses startup.
