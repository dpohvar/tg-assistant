# Storage

The service separates controller state from each bot's shared workspace. Paths are configured in `config.json`; see [operations](operations.md).

## Layout

| Location | Contents |
|---|---|
| `dataDir/controller.sqlite` | Bots, roles, chats, agent records, history, task firings, vault, MCP configuration, widgets and sticker-set catalog |
| `dataDir/secrets/` | Bot tokens, Git tokens, and the search-cursor signing key |
| `dataDir/rules/BOT_ID/AGENTS.md` | Administrator-managed rules supplied to every agent of that bot |
| `botsDir/BOT_ID/` | Shared permanent files and optional Git repository |
| `botsDir/BOT_ID/.temp/AGENT_ID/` | One agent's temporary files |
| `codexHome/` | CLI authorization, runtime sessions, and generated-image sources |

SQLite uses WAL and foreign keys. Current schema version is 20. Migration 19 adds durable agent control, compaction, work-origin and command-reply state; migration 20 adds event-owned grouped-button rollback receipts. Safe terminal control metadata expires after 30 days; pending/unknown control records remain protected. Ordinary queued inputs remain RAM-only. See [agent control](agent-control.md). Migration 15 splits widget state from message views, preserves old widget identities/state/source paths and known projections, converts disabled registrations to stopped and discards their backlog. Unknown first sends become separate publication candidates. Migration 16 adds inline button definitions, closed groups, owners, confirmed snapshots and queue-admission records. Migration 17 adds durable guest requests and publication outcomes. Migration 18 adds agent-owned ephemeral snapshots with 30-day retention outside ordinary history/search; confirmed prepared replies survive restart, while admitted model events remain RAM-only. See [hidden correspondence](ephemeral.md). Upgrades run transactionally before polling; corrupt payloads roll back. A newer schema is rejected. Back up SQLite, bot files and controller-owned widget snapshots/receipts together. Old code requires the old backup, not an in-place downgrade.

Ordinary model queues and inline query/ready buffers are RAM-only. Inline lifetime is one common hour; restart loses requests. Widget state, views and waiting durable reply/reaction/poll/external events survive independently of history. Stopped widgets retain no queue. In-flight work, buttons and local runtime data are not replayed. Per-view publication receipts preserve uncertainty without overwriting newer observations or retrying sends.

Inline definitions last 30 days from first registration. Group tombstones prevent reopening consumed card/group combinations. Event insertion/group closure are atomic; queue marking commits before model dispatch. Marked events are not replayed. Snapshots last 30 days from the last confirmed edit; ownership is retained for recent callbacks/edits and live views. Unknown edits keep last confirmed content with uncertainty. Query text and unrequested results are not persisted in these tables.

Topic registry entries survive retention/mode changes; chat deletion cascades them. Pending scheduler firings are durable and are not deleted by history retention.

## Sticker-set catalog

`sticker_sets` stores bot ID, case-insensitive set name, cached title/type, Telegram owner user ID and confirmed/uncertain creation status. It has no agent ID, semantic labels, downloaded bytes or expiry. All model agents of the same bot share it; deleting/resetting an agent does not remove it. Bot deletion cascades local records without deleting remote Telegram sets.

Creation saves an uncertain intent before calling Telegram and confirms it after success. A lost confirmation remains visible separately in `sticker_sets().uncertain`; it is not automatically retried or promoted by a read. Confirmed Telegram rejection removes the intent. Confirmed set deletion removes the catalog entry; failed or unknown deletion retains it. Confirmed title edits and live reads refresh cached metadata. Telegram has no Bot API method to enumerate all sets a bot created, so old/external sets remain accessible through `sticker_set_get` by name/link but are not imported into this catalog. See the [tool contract](agent-contract.md#sticker-sets-and-custom-emoji-sets).

## Browse session cache

[`/browse`](commands.md#interactive-file-browser) sessions, clipboard paths, confirmations, invitations and media buffers are RAM-only, separate from history/widgets. One session per bot/user expires after an idle hour or restart. A replacement message retains cache and active work. The media cache stores up to 64 MiB of prepared bytes and observed Telegram file IDs. No cache files enter bot directories/archives. Unknown delivery disables affected controls until a new browse; no effects are replayed on restart.

## Message history

See [usage accounting](#usage-accounting) for separate numerical monitoring data.

Incoming and known outgoing Telegram messages are stored with their native payload, searchable text, sender, reply linkage, original sent date, latest edit date, first receipt time, and a monotonically increasing receipt sequence. Edits replace the saved payload without resetting its receipt time. Known reactions are retained when an ordinary update lacks them.

Retention uses the first controller receipt time, not the Telegram sent date. A very old message newly included inside a reply can therefore be read through that outer message. The full read representation preserves Telegram-style fields, converts `date`/`edit_date` to readable ISO strings, and includes known synthetic permits. See [message events](message-events.md).

Cleanup runs every 24 hours while the service is running:

| Data | Expiry threshold |
|---|---|
| Saved Telegram messages | First receipt older than 30 days |
| Guest request payloads and publication attempts | Original guest receipt reaches 30 days; separate from ordinary chat history |
| Interagent message audit records | Date older than 7 days |
| Temporary files | `mtime` older than 24 hours |
| Registered native image-generation sources | `mtime` older than 24 hours |

These are cleanup thresholds, not exact maximum lifetimes. A daily sweep can leave expired data until the next run, and no cleanup runs during downtime. Unprocessed scheduler firings are not deleted by message-history retention.

Guest request records use their own opaque handles and bot/agent ownership, without connecting the destination chat or inserting its numeric addresses into ordinary history. Each explicit publication attempt has its own result record; a request can retain several successful inline message IDs. Access checks enforce the 30-day request deadline between cleanup sweeps. Deleting a guest request does not delete a live widget view or the inline ownership that view still needs. Local retention does not establish Telegram's answer deadline.

## Usage accounting

`usage_bots` records stable Telegram identity, last known username and collection start independently of bot registration. `usage_buckets` stores eight numeric counters per bot and UTC calendar slot: input, output, cached input, reasoning output, cache-write input, runtime total tokens, image starts and generated bytes. Lifetime and yearly totals survive indefinitely; monthly/daily/hourly detail retains the current period plus 11/29/23 preceding periods. Expired detail is trimmed during writes and daily cleanup; queries also filter expired slots.

`usage_threads` stores per-thread ownership and cumulative token baselines. `usage_images` independently deduplicates image starts and completions by thread/item ID. Baseline and aggregate changes share a transaction. Resume replays cannot inflate totals. First observations of existing sessions seed counters. A decrease associated with an observed new turn establishes a new baseline without adding that reset value; stale decreases are ignored. Both are logged. A new context has its own baseline. Context disposal removes its dedup records; completed child records and orphaned contexts are also eligible for cleanup after seven days without recent activity. Image item deduplication records expire after seven days without updates, including on saved roots. Active saved root token baselines remain available across idle periods and service restarts.

No prompts, credentials, image files or report snapshots are stored in accounting tables. Generated bytes mean file size measured at native completion, not retained disk usage. Numerical bot totals remain after unregistering or deleting files. See [master bot](master-bot.md#usage-statistics) for commands and completeness limits.

## History access and searches

Agents can read their own private history and all connected non-private chat history of the same bot. `history` uses a half-open positional slice relative to a message; a null anchor selects the position after the newest message. `search` supports literal text substrings, sender, type, date bounds, channel-discussion filters, and optional forum `topicId` filters (also available after forum mode is disabled).

Search cursors are signed, scoped to bot and agent, and expire one hour after starting the search. No stored result set or separate cursor table is needed. The receipt-sequence boundary excludes subsequently inserted records, and date/message-ID positions paginate newest first. Edits and retention can still change results between pages; cursors are not immutable database snapshots. Continue using the cursor alone, and stop when `nextCursor` is absent.

## Notes and shared files

Each agent has one private persistent note of at most 4,000 Unicode code points, accessed through `note_get`/`note_set`. Use it for stable chat preferences such as time zones, preferred names, and recurring context. Updating replaces the whole note. Notes survive context clearing, rules updates, and stopping the agent; leaving/deleting the chat removes them.

All agents of a bot share read/write permanent files. Wiki structure is chosen by the owner and bot rules; no mandatory `raw/`, `log.md`, ingest service, or query/lint tools are imposed. Git is optional. Store long-lived working knowledge in permanent files and confidential chat preferences in the private note. Shared files are not private to a single agent.

Agents may create arbitrary temporary subdirectories under their own `.temp/AGENT_ID/`. Conventional directories include `download`, `upload`, `generated`, and `websocket`. The sandbox denies other agents' temp directories. Local uploads are authored as `file:path` in structured media fields and use controller-managed multipart transfers; files are not deleted immediately after successful sending. Preserve anything needed long term outside `.temp`.

`download` caches Telegram file IDs per agent and coalesces concurrent requests for the same ID. Reusing an existing file does not refresh its `mtime`. `save_image` copies a registered native generation into shared files or the caller's temp directory; only a controller-registered source is accepted. Agents should handle paths rather than printing image base64 into context.

`download_custom_emoji` resolves custom emoji IDs to native Sticker metadata on each call and reuses `download` for the original files. Its byte cache is shared with ordinary downloads by file ID, remains private to the calling agent, and uses the same retention. Derived animation frames belong in the agent's own temp directory; the controller does not render or prefetch sticker/emoji artwork automatically.

WebSocket binary files have additional [connection lifecycle limits](websocket.md), including deletion one hour after closing the connection.

## Git

`git_changes` reports staged, unstaged, and untracked files plus commits outside the locally known remote branch. It does not fetch, so the remote-tracking reference can be stale. `git_sync` stages changes including deletions, commits if needed, and pushes; it never pulls or fetches. `.temp` is forcibly excluded and removed from the index if necessary, including when it is already ignored by `.gitignore`. Other ignore rules remain effective for untracked files. Paths are staged literally, so spaces and pattern characters in file names do not change which files are selected.

Administrator `/git setup BRANCH [REMOTE_URL [TOKEN]]` is a destructive workspace replacement, not routine synchronization. It clones the requested remote branch into staging, then replaces the bot's workspace except `.temp`. Local changes and unpushed commits are lost. An unsuccessful clone leaves the previous workspace intact. A remote containing `.temp` is rejected. Missing URL/token reuse saved settings.

Git credentials are held outside the workspace and passed through an askpass helper. Git hooks, global/system configuration, credential helpers, signing, and fsmonitor are disabled for controller Git operations. The sandbox denies direct access to `.git`; agents use the Git controller tools.

## Removal

Removing a chat deletes its agent, notes, tasks, history, interagent records involving it, owned session records, and temp resources. Permanent shared files remain. Stopping an agent is different: it preserves chat data and schedules while deleting context.

Removing a bot deletes controller registration and associated state; the master command can preserve its workspace or also delete all files. These commands do not delete the Telegram bot in BotFather. Back up both durable control data and workspaces before application upgrades or destructive administration.
