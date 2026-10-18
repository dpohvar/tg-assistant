# Architecture

The Node.js controller connects Telegram Bot API long polling to Codex App Server over stdio. SQLite stores durable state; ordinary agent-event queues and WebSocket buffers are in memory. Alpine Linux is the deployment target, with Windows used for development.

## Bots and agents

The [master bot](master-bot.md) has no agent. It accepts service-administration commands from `serviceOwnerId` and registers independent Telegram bots using their own tokens. Telegram BotFather ownership and ownership inside this application are separate.

A registered bot is the primary access boundary. It has one owner, per-bot roles, a shared file directory, one set of rules, a default model, vault entries, and HTTP MCP settings. Agents of different bots cannot send controller-mediated messages to each other.

An enabled private chat, group, or supergroup has one agent record and a persistent Codex thread. New groups and supergroups are passive until explicitly enabled. Authorized private chats start enabled when first recorded. Channels always remain passive. [Forum groups](forum-groups.md) use one agent across all topics; changing forum mode preserves chat data.

## Controller responsibilities

| Component | Responsibility |
|---|---|
| Telegram polling | Receive allowed update types, persist offsets, retry transport failures |
| Command router | Parse commands and check roles before invoking deterministic administration |
| Chat controller | Save messages, collect albums, detect triggers, route events, manage lifecycle |
| Agent queue | Batch admitted events, queue during work, steer during recognized waits |
| Codex adapter | Start/resume threads, provide instructions and tools, observe root/subagent activity |
| Usage accounting | Attribute reported token deltas and native image counts/bytes to bots; provide master reports |
| Message layer | Validate chat access and local attachments, pass Telegram file IDs through, call Telegram, persist known results |
| Scheduler | Store tasks/firings, coalesce occurrences, recover failures and overdue one-time events |
| WebSocket manager | Hold connections independently of turns and buffer incoming data |
| Retention | Periodically remove expired history, interagent records, and temporary files |

The controller sends agents JSON arrays of [events](message-events.md). Agents publish through controller tools; final Codex text is internal and is not automatically sent to Telegram. Built-in Codex tools provide shell execution, web search, image generation, and subagents subject to the configured sandbox. Administrator-configured HTTP MCP tools are exposed natively by Codex.

## Persistence and failures

SQLite migrations run transactionally before event processing; unsupported newer schemas are refused. Stored tasks, notes, rules, model choices, and desired agent enabled state survive restart. In-memory chat queues and WebSocket streams do not. The service accepts this loss for personal use; it does not promise exactly-once message processing or side effects.

The controller uses generation checks and per-bot gates to reject stale tool connections and hold new work during maintenance. Context resets wait for active root work, subagents, and controller operations. A technical agent failure clears its ordinary queue, reports in its current chat, and informs agents with outstanding delegated requests. Scheduler failures remain durable and retryable.

For details, see [agent lifecycle](agents.md), [storage](storage.md), [scheduler](scheduler.md), and [security](security.md). Startup, process locking, and SSH service management are described in [operations](operations.md).

## Widget execution

[Widgets](widgets.md) use one sandboxed foreground Node process per owner, independently of the model queue. Each widget shares state, serial event processing and timers across zero or more views. SQLite owns registrations, views, projections and durable admission. The watchdog monitors the launcher tree; generation fencing prevents retired effects. Restart initializes active widgets without replaying in-flight effects. Stopped widgets discard their queues. The [inline service](inline.md) keeps queries/results in RAM while persisting delivered action definitions, ownership and known edits.
