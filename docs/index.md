# Telegram Assistant wiki

Telegram Assistant runs Telegram bots backed by Codex CLI. A service owner registers bots through a separate master bot. Each registered bot has its own access roles, rules, shared files, and optional chat agents.

This wiki describes the current implementation. Start with [installation and operations](operations.md) to deploy the service, or [architecture](architecture.md) to understand its components.

| Article | Contents |
|---|---|
| [Architecture](architecture.md) | Controller, bots, chat agents, persistence, and runtime boundaries |
| [Master bot](master-bot.md) | Registering bots, assigning owners, and removing bots |
| [Child-bot commands](commands.md) | Command syntax, roles, chat administration, and file commands |
| [Agents](agents.md) | Instructions, models, context, triggers, queues, and lifecycle |
| [Agent contract](agent-contract.md) | Controller tools, arguments, results, and errors |
| [Message events](message-events.md) | Event batches, short messages, detailed reads, and examples |
| [Messaging](messaging.md) | Text, rich messages, media, buttons, callbacks, and permits |
| [Inline mode](inline.md) | Paginated agent results, action buttons, inline ownership and media buffers |
| [Guest Mode](guest-mode.md) | Explicit mentions outside member chats, personal-agent routing and guest request storage |
| [Widgets](widgets.md) | Sandboxed programmable messages, TSX handlers, timers, events and administration |
| [Scheduler](scheduler.md) | One-time tasks, cron, time zones, failures, and retries |
| [Storage](storage.md) | Database, history, notes, shared files, temporary files, and Git |
| [Security](security.md) | Access boundaries, sandbox, network access, and vault |
| [Channels and discussions](channels-and-discussions.md) | Passive destinations, channel publishing, and comment searches |
| [Forum groups](forum-groups.md) | One agent across topics, delivery, observed names, history filters and listening |
| [WebSocket](websocket.md) | Persistent connections, notifications, buffering, and binary files |
| [HTTP MCP](mcp.md) | Per-bot remote tool configuration and runtime refresh |
| [Operations](operations.md) | Requirements, SSH installation, configuration, service lifecycle, and updates |

[Development archive](dev/index.md) preserves earlier discussions, plans, and verification reports. Historical reports describe the environments and versions actually tested; they are not a replacement for this wiki or a guarantee about a future deployment.
