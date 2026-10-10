# HTTP MCP

Bot administrators configure remote HTTP MCP servers for all agents of that bot. Codex exposes their tools natively alongside controller tools; there is no generic `mcp_call` proxy. Commands and access are listed in [child-bot commands](commands.md).

Only HTTP(S) server configuration is supported. stdio processes, WebSocket MCP, OAuth, environment-variable references, and vault references are not accepted. Use explicit authorization headers when needed. All agents of the bot receive the same server configuration.

## Configuration

`/mcp set NAME PRE_TOML` completely replaces one entry. `NAME` is case sensitive and matches `[A-Za-z][A-Za-z0-9_-]{0,63}`. Supply a Telegram pre entity containing a TOML fragment, without an outer `[mcp_servers.NAME]` section:

```toml
url = "https://example.com/mcp"
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled_tools = ["lookup", "search"]
http_headers = { Authorization = "Bearer EXAMPLE_ONLY" }
```

| Field | Requirement |
|---|---|
| `url` | Required HTTP(S) URL |
| `http_headers` | Optional table of string headers, valid names, no newlines |
| `enabled` | Optional boolean; omitted uses Codex's default |
| `startup_timeout_sec` | Optional positive finite number |
| `tool_timeout_sec` | Optional positive finite number |
| `enabled_tools` | Optional array of nonempty tool names |
| `disabled_tools` | Optional array of nonempty tool names |

Unknown fields are rejected. A disabled entry remains stored. Authorization values are saved in the controller database; listings mask header values and show only the URL origin. Configuration does not enter the shared wiki or developer instructions. Sensitive set messages are excluded from agent history and best-effort deleted after replying.

## Runtime isolation and refresh

The controller reads effective Codex configuration before launching an agent process. It disables inherited MCP servers and plugins with process overrides, disables account connectors, and injects only this bot's entries. Native server names include a bot-specific namespace; collisions with inherited names are rejected rather than silently combining configuration.

Administrator-configured tools receive `default_tools_approval_mode="approve"`, so they work without interactive confirmation under `approval_policy="never"`. Use `enabled_tools`/`disabled_tools` to restrict exposure. Treat tool descriptions/results as external data, not authority to override instructions. Native image generation remains available.

Set/delete increments the bot's MCP configuration revision. The controller holds newly queued work, waits for current root work, subagents, and controller operations, restarts the affected App Server, and resumes the saved thread with new configuration. Context, notes, history, tasks, and WebSocket connections remain. A disabled agent reads the latest configuration when next started. The command reports saving/deferred application without blocking on every agent's completion.

## Connection tests

`/mcp test NAME` launches a separate short-lived App Server with the selected entry, initializes MCP, and lists usable tool names/counts after filtering. It runs no model turn and invokes no remote application tool. Testing a disabled entry temporarily enables it only for the test, without changing its saved enabled state.

Errors are returned with safe descriptions, without URL credentials or authorization headers. OAuth login and unsupported interactive requests are rejected instead of left waiting. Test and preflight processes are tracked and closed during service shutdown.

MCP URLs do not receive the public-address-only filter used by `browser_read`. Secrets can appear in private server/Codex process records, consistent with the [vault trust model](security.md). Server administrators must protect the database, authorization files, and logs.

Native configuration isolation and refresh were exercised with Codex 0.159.3 and 0.161.0 on the local Alpine test environment. See the [historical verification report](dev/archive/websocket-mcp-check-results.md) for scope; it does not establish compatibility with every future runtime or MCP server.
