# HTTP MCP

Bot administrators configure remote HTTP MCP servers for all agents of that bot. Codex exposes their tools natively alongside controller tools; there is no generic `mcp_call` proxy. Commands and access are listed in [child-bot commands](commands.md).

Only HTTP(S) server configuration is supported. stdio processes, WebSocket MCP, environment-variable references, and vault references are not accepted. Authentication can use explicit headers or native Codex OAuth. All agents of the bot receive the same server configuration and share one authorized external account per connection.

## Configuration

`/mcp set NAME PRE_CONFIG` completely replaces one entry. `NAME` is case sensitive and matches `[A-Za-z][A-Za-z0-9_-]{0,63}`. Supply the configuration in a Telegram pre entity in the same message as the command. Use one JSON object or TOML fragment, without an outer `mcpServers` object or `[mcp_servers.NAME]` section:

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
| `http_headers` / `headers` | Optional table of string headers, valid names, no newlines |
| `type` | Optional compatibility field; only `"http"` is accepted and discarded |
| `enabled` | Optional boolean; omitted uses Codex's default |
| `startup_timeout_sec` | Optional positive finite number |
| `tool_timeout_sec` | Optional positive finite number |
| `enabled_tools` | Optional array of nonempty tool names |
| `disabled_tools` | Optional array of nonempty tool names |
| `oauth` | Optional table with `client_id`, `client_secret`, `scopes`, `callback_url`, and `callback_port` |

Unknown fields are rejected. A disabled entry remains stored. Authorization values are saved in the controller database; listings mask header values and show only the URL origin. Configuration does not enter the shared wiki or developer instructions. Sensitive set messages are excluded from agent history and best-effort deleted after replying.

OAuth client registration normally uses Codex discovery. Services requiring a pre-registered client may use:

```toml
url = "https://example.com/mcp"

[oauth]
client_id = "REGISTERED_CLIENT_ID"
scopes = ["calendar.read"]
callback_url = "http://127.0.0.1/callback"
```

`client_id` and optional `client_secret` must be nonempty strings without newlines; `scopes` is an array of nonempty strings without whitespace. The callback uses HTTPS, or HTTP on a loopback host, without credentials or a fragment. Optional `callback_port` is an integer from 1 to 65535. Codex determines the exact redirect URI and any provider-specific callback suffix. Register that exact address with the provider; the controller does not replace its validation. Native callback/client behavior may depend on the Codex version.

Both formats accept `serverUrl` as an alias for `url`, `headers` as an alias for `http_headers`, and `clientId`/`clientSecret` as aliases for `client_id`/`client_secret`. Optional `type: "http"` is discarded; other transport types are rejected. Conflicting aliases fail validation. `client_secret` requires `client_id` and is masked by `/mcp show`. It is stored in the controller database and supplied to native Codex configuration; it may appear in server process arguments/records, which are visible to server administrators. OAuth scopes are mapped to the native server-level `scopes` setting. This is single-entry compatibility, not support for whole Antigravity/Claude configuration files.

For example, send `/mcp set calendar` followed by this pre block:

```json
{
  "serverUrl": "https://calendarmcp.googleapis.com/mcp/v1",
  "oauth": {
    "clientId": "EXAMPLE_CLIENT_ID",
    "clientSecret": "EXAMPLE_CLIENT_SECRET",
    "callback_port": 32123,
    "scopes": ["https://www.googleapis.com/auth/calendar.events.readonly"]
  }
}
```

Google's direct Calendar MCP additionally requires the Google Cloud project to be enrolled in the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview) and the relevant APIs enabled. Follow the [Google configuration guide](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server) for project setup and scopes needed by the intended tools. Successful OAuth and a tool listing do not remove these provider requirements. Register the redirect URI shown by this bot, rather than copying Antigravity's or Claude's callback address.

## OAuth login and logout

In a private child-bot chat, an admin/owner sends `/mcp auth NAME`. The reply also shows the exact redirect URI for provider registration. The controller starts a separate `codex mcp login` process using `--no-browser` and this bot's native server namespace. It replies with the authorization link, with link previews disabled. Open the link, approve access, then copy the complete URL from the browser address bar even if the callback page cannot load. Send the URL as a reply to your own original `/mcp auth NAME` command.

The controller checks the caller's current role, original command sender/chat/message identity, absence of editing, callback origin/path, and matching `state`. The original command must address this bot. A validated error callback cancels the attempt immediately; a code callback is passed to the waiting CLI through stdin. The controller never fetches the submitted URL. Codex owns discovery, PKCE, issuer checks and token exchange. Callback messages have deletion attempted and are excluded from model input and stored history, including edited callbacks and recognizable callback URLs submitted without a valid invitation. Callback processing does not accept arbitrary formatted text or documents; a plain URL, URL entity, inline code or spoiler is accepted.

One pending attempt is allowed per connection. A new auth command replaces it; the pending attempt expires after ten minutes and does not survive application restart. Existing credentials remain until a successful login replaces them. Failed or denied login does not authorize a connection. Login completion refreshes agents at the existing idle boundary without clearing context.

`/mcp logout NAME` cancels pending login and removes the connection's local OAuth credentials. Static authorization headers remain. Other connections and bots retain their credentials. Replacing/deleting an MCP configuration cancels its pending attempt and removes local credentials before changing the saved entry; if cleanup fails, the old entry remains. Unregistering a bot also removes its local MCP credentials. Local logout does not necessarily revoke the grant at the provider.

The controller forces Codex file credential storage in the protected `codexHome`, outside bot directories. Login, tests and agents use the same store and bot-specific native server names. Successful credentials survive process/application restarts. Codex refreshes expired access tokens. When a native status check reports authorization required, the owner receives one safe notification per connection until successful authorization rearms notifications. Checks occur at agent startup/turn completion; this is not an immediate provider-revocation monitor. Deliberate logout suppresses repeated reminders for that connection during the current application run.

Login children have bounded startup/output and are terminated on timeout, configuration change, bot deletion or shutdown. Cancellation escalates to SIGKILL if necessary. Raw process output is never returned in command errors.

## Runtime isolation and refresh

The controller reads effective Codex configuration before launching an agent process. It disables inherited MCP servers and plugins with process overrides, disables account connectors, and injects only this bot's entries. Native server names include a bot-specific namespace; collisions with inherited names are rejected rather than silently combining configuration.

Administrator-configured tools receive `default_tools_approval_mode="approve"`, so they work without interactive confirmation under `approval_policy="never"`. Use `enabled_tools`/`disabled_tools` to restrict exposure. Treat tool descriptions/results as external data, not authority to override instructions. Native image generation remains available.

Set/delete increments the bot's MCP configuration revision. The controller holds newly queued work, waits for current root work, subagents, and controller operations, restarts the affected App Server, and resumes the saved thread with new configuration. Context, notes, history, tasks, and WebSocket connections remain. A disabled agent reads the latest configuration when next started. The command reports saving/deferred application without blocking on every agent's completion.

## Connection status and tests

`/mcp` and `/mcp list` check enabled entries and display `connected`, `disabled`, `authorization required`, or `unavailable`. Each row contains the connection name formatted as code, the URL origin, and an italic status, separated by ` · `. Disabled entries are not contacted. Checks use separate native test runtimes, with up to four in parallel, and call no application tool or model. The URL is reduced to its origin and raw failures are hidden. A connected status confirms MCP initialization and available tools, not permission to execute every tool: provider restrictions such as Google Developer Preview can still reject an application call. `/mcp test NAME` also displays the native OAuth state; tools may be listed before login.

Command replies and status labels are in English. A list row renders as: `calendar` · https://calendarmcp.googleapis.com · *connected*.

`/mcp test NAME` launches a separate short-lived App Server with the selected entry, initializes MCP, and lists usable tool names/counts after filtering. It runs no model turn and invokes no remote application tool. Testing a disabled entry temporarily enables it only for the test, without changing its saved enabled state.

Errors are returned with safe descriptions, without URL credentials or authorization headers. Missing OAuth authorization suggests `/mcp auth NAME`; a test does not start interactive login. Other unsupported interactive requests are rejected instead of left waiting. Test and preflight processes are tracked and closed during service shutdown.

MCP URLs do not receive the public-address-only filter used by `browser_read`. Secrets can appear in private server/Codex process records, consistent with the [vault trust model](security.md). Server administrators must protect the database, authorization files, and logs.

Native configuration isolation and refresh were exercised with Codex 0.159.3 and 0.161.0 on the local Alpine test environment. See the [historical verification report](dev/archive/websocket-mcp-check-results.md) for scope; it does not establish compatibility with every future runtime or MCP server.

OAuth manual callback, credential isolation, restart loading and refresh were exercised with Codex 0.159.3 on Alpine using a synthetic provider. See the [OAuth report](dev/mcp-oauth-probe.md). An external-provider login link is not proof of completed external-account integration.
