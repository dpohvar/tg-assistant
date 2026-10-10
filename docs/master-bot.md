# Master bot

[Wiki home](index.md) · [Child bot commands](commands.md) · [Operations](operations.md)

The master bot manages child registrations. It has no conversational agent. Only the configured `serviceOwnerId` may use it, in a private Telegram chat; messages elsewhere or from other users are ignored. The master token is configured at startup, separately from child tokens. See [Architecture](architecture.md), [Storage](storage.md), and [Security](security.md).

## Commands

| Command | Result |
|---|---|
| `/help` | Master command help |
| `/help bot` | Bot management section (the only master help section) |
| `/bot`, `/bot list [RANGE]` | Registered child bots |
| `/bot add TOKEN [OWNER_ID]` | Register a child bot and assign its application owner |
| `/bot info @BotName` | Profile, Telegram bot ID, owner and chat/agent counts |
| `/bot owner @BotName` | Current owner |
| `/bot owner set @BotName USER_ID` | Assign a new application owner |
| `/bot delete @BotName` | Display identity and complete deletion commands |
| `/bot delete @BotName BOT_ID` | Unregister and remove controller data, retaining wiki/Git |
| `/bot delete @BotName BOT_ID all` | Also delete the complete bot directory, including wiki/Git |

`RANGE` is a positive one-based position `N` or inclusive `FROM-TO`; omitted means the first 10. Bots sort by numeric Telegram bot ID. Lists show `FROM-TO / TOTAL`, then username, bot ID and owner ID; IDs use code formatting. Bot lookup is case-insensitive and accepts a name with or without `@`. Replies, argument formatting and errors follow the [command syntax](commands.md#syntax-formatting-and-help); no pre blocks are accepted here.

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
