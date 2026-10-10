# Telegram Assistant

A Telegram assistant service powered by Codex CLI. Register separate bots through a master bot, enable agents in private chats or groups, and let them work with shared files, scheduled tasks, channels, and external tools.

- Per-bot ownership, roles, rules, model settings, and isolated workspaces.
- Chat history, persistent notes, optional Git synchronization, and image generation.
- Text, rich messages, albums, callback buttons, and media reuse.
- Durable one-time/cron tasks, channel publishing, and comment searches.
- Browser/PDF readers, secret vault, active WebSocket connections, and HTTP MCP.

The deployment target is Alpine Linux; Windows is used for development. Node.js **24.18.1 or newer** and an authenticated Codex CLI are required. Codex **0.159.3** is the validation baseline; other versions are allowed with a warning. Selected integrations were also checked with **0.161.0**.

## Getting started

Follow [installation and operations](docs/operations.md) for the complete SSH setup, dependencies, Codex login, token storage, and sandbox checks. Use [config.example.json](config.example.json) as a configuration template. Runtime data and credentials must stay outside the repository.

After preparing configuration and authorization:

```sh
npm ci
npm test
npm run service:alpine_start -- /absolute/path/config.json
npm run service:alpine_status -- /absolute/path/config.json
npm run service:alpine_stop -- /absolute/path/config.json
```

Register and manage bots using the [master bot](docs/master-bot.md). Manage each bot's agents, access, rules, tasks, and files using [child-bot commands](docs/commands.md). New groups and non-forum supergroups are passive until `/agent start`; channels remain passive destinations. Forum groups are unsupported.

## Documentation

- [Wiki index](docs/index.md)
- [Architecture](docs/architecture.md)
- [Agent tools](docs/agent-contract.md) and [message events](docs/message-events.md)
- [Security and privacy](docs/security.md)
- [Development archive](docs/dev/index.md)

After updating the application, use `/agent clear *` when existing agents need refreshed service instructions. Follow the [upgrade procedure](docs/operations.md) for backups and database migrations.
