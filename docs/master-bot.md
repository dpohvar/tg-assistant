# Master bot

[Wiki home](index.md) · [Child bot commands](commands.md) · [Operations](operations.md)

The master bot manages child registrations. It has no conversational agent. Only the configured `serviceOwnerId` may use it, in a private Telegram chat; messages elsewhere or from other users are ignored. The master token is configured at startup, separately from child tokens. See [Architecture](architecture.md), [Storage](storage.md), and [Security](security.md).

## Commands

| Command | Result |
|---|---|
| `/help` | English argument-formatting guide and bot management section description |
| `/help bot` | Detailed English bot management help |
| `/help usage` | Usage accounting and comparison help |
| `/bot`, `/bot list [RANGE]` | Registered child bots |
| `/bot add TOKEN [OWNER_ID]` | Register a child bot and assign its application owner |
| `/bot info @BotName` | Profile, Telegram bot ID, owner and chat/agent counts |
| `/bot owner @BotName` | Current owner |
| `/bot owner set @BotName USER_ID` | Assign a new application owner |
| `/bot delete @BotName` | Display identity and complete deletion commands |
| `/bot delete @BotName BOT_ID` | Unregister and remove controller data, retaining wiki/Git |
| `/bot delete @BotName BOT_ID all` | Also delete the complete bot directory, including wiki/Git |
| `/usage` | Lifetime totals per bot, sorted by input tokens |
| `/usage all` | Lifetime totals summed across all bots |
| `/usage @BOT` | Lifetime totals for one bot |
| `/usage @BOT hours\|days\|months\|years` | Lifetime totals and stored nonzero UTC buckets for one bot |

`RANGE` is a positive one-based position `N` or inclusive `FROM-TO`; omitted means the first 10. Bots sort by numeric Telegram bot ID. Lists show `FROM-TO / TOTAL`, then username, bot ID and owner ID; IDs use code formatting. Bot lookup is case-insensitive and accepts a name with or without `@`. Replies, argument formatting and errors follow the [command syntax](commands.md#syntax-formatting-and-help); no pre blocks are accepted here.

## Inline preview fallback

The master's Telegram profile photo is the fallback for a child bot without an available avatar in the first [inline drum](inline.md#pagination-and-lifetime) item. Set it using Telegram's normal bot profile controls; no controller command or photo message is required. Each child obtains the master's profile photo through its own token, without downloading or reuploading it. An available child avatar takes priority. If neither profile photo is available, the ordinary drum remains usable with the known Desktop preview limitation. Profile changes can take up to five minutes to appear because lookups are cached. Sending a photo to the master does not configure this fallback.

## Registration and ownership

Create a Telegram bot and obtain its token through BotFather, then send `/bot add TOKEN [OWNER_ID]` to the master. The controller validates token syntax and probes `getMe`. The master itself and already registered bots cannot be registered as children. Without `OWNER_ID`, the command sender becomes owner. Owner IDs must be positive safe integers; prior child-bot authorization is not required.

Registration creates a separate bot directory and controller records, stores its token outside the wiki with restrictive permissions, and starts its Telegram poller. Set rules and authorize users through the child bot's [commands](commands.md). Chat connection and passive/active behavior are documented in [Channels and discussions](channels-and-discussions.md) and [Agents](agents.md).

Master ownership assignment also accepts an unregistered user. This differs from the child `/owner set`, which requires the new owner to be authorized already. The old owner becomes admin; assigning the same owner leaves it unchanged. Other bot data and agent contexts remain. Ownership here is application ownership, not a BotFather transfer.

Token-bearing registration messages are never given to agents. The controller attempts to delete them from Telegram after success or failure; this cannot erase copies already held by clients. Bot info and lists do not return token values.

## Deletion

The short delete form only displays the bot's identity and exact confirmation syntax. To perform deletion, repeat its numeric Telegram `BOT_ID` (not the internal `b…` ID). No further confirmation is requested. For example:

```text
/bot delete @ExampleAssistant
/bot delete @ExampleAssistant 123456789
```

Deletion first stops the poller. It removes the bot's database records, token and Git credential files, rules, registered generated-image sources and `.temp`. Without `all`, permanent bot files and the Git repository remain on disk; with `all`, the entire directory is removed. It does not delete the Telegram bot in BotFather. Retained files do not preserve the removed conversations, agents, notes, schedules or settings. Take a [backup](operations.md#backups-and-restoration) before deletion if those data must remain recoverable.

Controller command replies and errors are in English. User-supplied content retains its original language.

The short deletion command displays identity, owner, irreversible losses, and two code-formatted confirmation commands. Full confirmation forms appear in that invitation rather than `/help bot`. Both deletion modes retain numerical usage statistics, including their contribution to service totals.

## Usage statistics

Usage is collected from Codex notifications and attributed to the stable Telegram bot ID, including native subagents. Removed bots remain in reports with `removed`; re-registering the same Telegram bot continues its totals. A username identifies a bot for command input; reports include its numeric ID so comparisons survive renaming. An ambiguous reused name is rejected.

Reports show input/output tokens, image-generation starts (including failed attempts), and total bytes of successful generated native files. Reusing, copying, exporting or sending an image does not count as another generation. A missing/unreadable generated file contributes no bytes. The database also stores runtime-reported cached input, reasoning output, cache-write input and total tokens. Cached/reasoning values are details, not extra tokens to add to the input/output total. These reports do not measure API prices, subscription credits, local CPU usage or every external tool's cost.

`Total from` is collection start: per bot or per service for `all`. Existing sessions seed their baseline when collection begins, rather than assigning historical usage to the current hour. Collection does not reconstruct previous history. Current buckets are labeled `in progress`; the first partially collected month has no additional label.

The UTC windows include the current hour plus 23 preceding hours, current day plus 29 preceding days, current month plus 11 preceding months, and all recorded calendar years. Lifetime totals do not expire. Period options require a single bot; `/usage all hours` is rejected. Buckets with no reported activity are omitted. Reports are one Telegram message, newest periods first, truncated only between complete bot/period blocks, with `Output truncated` when needed.

Reply `/usage` without arguments to an intact report from this master bot to get current lifetime counters and their increases. Replying to `/usage` itself cannot compare data: use the bot's report. Edited or forwarded reports are rejected. Exact byte counts in report text allow comparison without storing snapshots. Elapsed time is approximate, using the previous report's Telegram send time. Per-bot comparisons sort by input-token increase; truncated reports compare only the bots fully displayed. A decreased counter or changed collection-start date produces `Counters reset; comparison unavailable`. Explicit arguments request a new ordinary report even when replying.

```text
/usage @ExampleBot hours
/usage all
```

Counters update when Codex reports them, not continuously during an unreported model operation. Resume replays and repeated notifications are deduplicated with durable thread/item records. A transport crash can lose unreported expense; compaction's own consumption is not fully exposed by the tested runtime. See [storage](storage.md#usage-accounting) for persistence and retention.
