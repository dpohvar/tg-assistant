# Storage

The service separates controller state from each bot's shared workspace. Paths are configured in `config.json`; see [operations](operations.md).

## Layout

| Location | Contents |
|---|---|
| `dataDir/controller.sqlite` | Bots, roles, chats, agent records, history, task firings, vault, and MCP configuration |
| `dataDir/secrets/` | Bot tokens, Git tokens, and the search-cursor signing key |
| `dataDir/rules/BOT_ID/AGENTS.md` | Administrator-managed rules supplied to every agent of that bot |
| `botsDir/BOT_ID/` | Shared permanent files and optional Git repository |
| `botsDir/BOT_ID/.temp/AGENT_ID/` | One agent's temporary files |
| `codexHome/` | CLI authorization, runtime sessions, and generated-image sources |

SQLite uses WAL and foreign keys. Current schema version is 10. Pending scheduler firings are durable; ordinary event queues and WebSocket records are not. Migrations occur before polling and reject a database from a newer application version.

## Message history

Incoming and known outgoing Telegram messages are stored with their native payload, searchable text, sender, reply linkage, original sent date, latest edit date, first receipt time, and a monotonically increasing receipt sequence. Edits replace the saved payload without resetting its receipt time. Known reactions are retained when an ordinary update lacks them.

Retention uses the first controller receipt time, not the Telegram sent date. A very old message newly included inside a reply can therefore be read through that outer message. The full read representation preserves Telegram-style fields, converts `date`/`edit_date` to readable ISO strings, and includes known synthetic permits. See [message events](message-events.md).

Cleanup runs every 24 hours while the service is running:

| Data | Expiry threshold |
|---|---|
| Saved Telegram messages | First receipt older than 30 days |
| Interagent message audit records | Date older than 7 days |
| Temporary files | `mtime` older than 24 hours |
| Registered native image-generation sources | `mtime` older than 24 hours |

These are cleanup thresholds, not exact maximum lifetimes. A daily sweep can leave expired data until the next run, and no cleanup runs during downtime. Unprocessed scheduler firings are not deleted by message-history retention.

## History access and searches

Agents can read their own private history and all connected non-private chat history of the same bot. `history` uses a half-open positional slice relative to a message; a null anchor selects the position after the newest message. `search` supports literal text substrings, sender, type, date bounds, and channel-discussion filters.

Search cursors are signed, scoped to bot and agent, and expire one hour after starting the search. No stored result set or separate cursor table is needed. The receipt-sequence boundary excludes subsequently inserted records, and date/message-ID positions paginate newest first. Edits and retention can still change results between pages; cursors are not immutable database snapshots. Continue using the cursor alone, and stop when `nextCursor` is absent.

## Notes and shared files

Each agent has one private persistent note of at most 4,000 Unicode code points, accessed through `note_get`/`note_set`. Use it for stable chat preferences such as time zones, preferred names, and recurring context. Updating replaces the whole note. Notes survive context clearing, rules updates, and stopping the agent; leaving/deleting the chat removes them.

All agents of a bot share read/write permanent files. Wiki structure is chosen by the owner and bot rules; no mandatory `raw/`, `log.md`, ingest service, or query/lint tools are imposed. Git is optional. Store long-lived working knowledge in permanent files and confidential chat preferences in the private note. Shared files are not private to a single agent.

Agents may create arbitrary temporary subdirectories under their own `.temp/AGENT_ID/`. Conventional directories include `download`, `upload`, `generated`, and `websocket`. The sandbox denies other agents' temp directories. Local uploads use multipart transfers; files are not deleted immediately after successful sending. Preserve anything needed long term outside `.temp`.

`download` caches Telegram file IDs per agent and coalesces concurrent requests for the same ID. Reusing an existing file does not refresh its `mtime`. `save_image` copies a registered native generation into shared files or the caller's temp directory; only a controller-registered source is accepted. Agents should handle paths rather than printing image base64 into context.

WebSocket binary files have additional [connection lifecycle limits](websocket.md), including deletion one hour after closing the connection.

## Git

`git_changes` reports staged, unstaged, and untracked files plus commits outside the locally known remote branch. It does not fetch, so the remote-tracking reference can be stale. `git_sync` stages changes including deletions, commits if needed, and pushes; it never pulls or fetches. `.temp` is forcibly excluded and removed from the index if necessary.

Administrator `/git setup BRANCH [REMOTE_URL [TOKEN]]` is a destructive workspace replacement, not routine synchronization. It clones the requested remote branch into staging, then replaces the bot's workspace except `.temp`. Local changes and unpushed commits are lost. An unsuccessful clone leaves the previous workspace intact. A remote containing `.temp` is rejected. Missing URL/token reuse saved settings.

Git credentials are held outside the workspace and passed through an askpass helper. Git hooks, global/system configuration, credential helpers, signing, and fsmonitor are disabled for controller Git operations. The sandbox denies direct access to `.git`; agents use the Git controller tools.

## Removal

Removing a chat deletes its agent, notes, tasks, history, interagent records involving it, owned session records, and temp resources. Permanent shared files remain. Stopping an agent is different: it preserves chat data and schedules while deleting context.

Removing a bot deletes controller registration and associated state; the master command can preserve its workspace or also delete all files. These commands do not delete the Telegram bot in BotFather. Back up both durable control data and workspaces before application upgrades or destructive administration.
