# Operations

[Wiki home](index.md) · [Architecture](architecture.md) · [Commands](commands.md) · [Master bot](master-bot.md)

Run the controller as a dedicated ordinary Linux user. The supported deployment workflow uses Alpine over SSH. Node.js must be at least **24.18.1**; the validated Codex CLI is **0.159.3**, with a native executable for the host architecture and musl. Startup executes `codex --version`: a different version produces a warning and continues with an unvalidated runtime; a failed version command prevents startup. Upgrading Codex requires fresh runtime and filesystem isolation checks.

## Install on Alpine over SSH

An administrator installs system dependencies. Ensure the Alpine repositories supply the required Node version; do not assume the distribution default satisfies the engine requirement.

```sh
apk add --no-cache git nodejs npm ripgrep tzdata ca-certificates curl chromium poppler-utils font-dejavu
```

`nohup` must also be available (BusyBox or coreutils). Install Codex separately, for example under `/opt/codex/bin`, and verify:

```sh
node --version
npm --version
/opt/codex/bin/codex --version
command -v nohup
chromium --version
pdftotext -v
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

## Configuration and authentication

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

1. Stop the service, confirm shutdown, and take a recoverable backup.
2. Update to the reviewed code revision and run `npm ci` and `npm test`; run native reader tests where their dependencies are installed.
3. Start using the same config and inspect status/logs. Database migrations run automatically in a transaction before Telegram events are accepted.
4. After instruction or tool-contract changes, use Admin `/agent clear *` in each child bot, or clear selected agents. Clear waits for current work and retains queued input, history, notes, files and tasks. A resumed native session alone is not a replacement for resetting stale instructions.
5. Complete bounded live runtime/tool probes appropriate to the upgrade.

The current schema is **10**. Migration records prevent reapplying completed migrations; a database newer than the controller supports is rejected. Do not delete/recreate the database to resolve migration failure: diagnose the cause and retry. Rolling back code after a schema change may require restoring the pre-upgrade backup. For details see [Storage](storage.md). `/rules set` clears contexts itself; MCP set/delete waits for current work and refreshes the App Server while preserving context, so those changes do not require a manual clear.

Keep logs private. Do not publish raw RPC payloads, base64 image results, token-bearing Telegram URLs or unsanitized shell/Codex logs; those can contain vault credentials. For the permissions and secret boundaries, see [Security](security.md). Runtime version warnings indicate unvalidated compatibility, not successful production acceptance.
