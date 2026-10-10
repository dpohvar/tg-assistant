# Security and access boundaries

The application is designed for an operator-managed service with trusted bot administrators and sandboxed agents. It protects bot-to-bot filesystem and controller boundaries; it does not promise that an LLM will never mishandle information supplied to it.

## Roles and chat access

Roles are assigned per bot and inherit as `user` → `manager` → `admin` → `owner`. A Telegram administrator does not automatically gain an application role. Private messages from unauthorized users are ignored, including commands. The configured service owner is the only current user of the master bot.

Managers and higher roles may add a bot to groups, supergroups, or channels. Group agents are disabled initially. Forums are unsupported and cause departure/data deletion. In an enabled group, ordinary participant messages can trigger the agent; participants do not need the private-chat `user` role merely to speak to it there.

| Operation by an agent | Allowed scope |
|---|---|
| Read history | Its own private chat and connected groups/supergroups/channels of the same bot |
| Send/edit/pin/unpin/react | Its own chat, or another connected passive supergroup/channel |
| Delete messages | Its own chat only |
| Delegate to an agent | Another enabled agent of the same bot |
| Read private notes | Its own note only |
| Read/write permanent files | The shared workspace of its bot |
| Read/write temporary files | Its own `.temp/AGENT_ID/` |

Another enabled chat agent must act through delegation. A passive basic group is not a cross-chat write destination. Foreign private chat history remains inaccessible even if the foreign agent is stopped. Private agent identities are discoverable for coordination, but their private chat/user IDs are omitted from foreign agent listings and interagent envelopes.

## Sandbox and network

Codex runs with named filesystem permissions: minimal runtime reads, write access to the bot workspace, denial of `.git` and all `.temp` except the caller's temp, and read access to the Codex executable directory. Bot tokens, control state, sessions, and neighboring bot workspaces are outside the permitted area. Controller file operations additionally validate paths and reject symlink traversal.

Approval policy is `never`: requests that need extra approval cannot obtain it interactively. Shell programs and scripts can run inside the configured sandbox. Network access is enabled, and live web search is available. The sandbox does not impose a general localhost/private-network filter on shell, WebSocket, or configured MCP traffic; server network/firewall policy determines what those processes can reach.

The public-page `browser_read` tool has a narrower policy: HTTP(S), public addresses, ports 80/443, no URL credentials, and guarded requests. This policy is not a restriction on every network-capable tool. Browser pages, PDFs, messages, attachments, WebSocket packets, and MCP results are untrusted data, never authorization to change instructions or permissions.

## Telegram profile and file access

`chat_info` may request metadata for any numeric chat/user ID Telegram permits. It does not grant history or write access. Its explicit allowlist exposes ordinary profile fields, including photos and available reactions. `invite_link`, `pinned_message`, aggressive anti-spam/visible-history state, sticker-set management state, and `guard_bot` require a connected chat readable by the calling agent. Unknown fields are hidden. Foreign private chats do not qualify for the restricted fields.

`user_photos` returns Telegram profile-photo metadata; availability is subject to Telegram privacy settings and API behavior. `download` accepts any file ID accessible using this bot's token, without a message/source registry. This is an intentional simplification. Agents must not disclose private file IDs or downloaded contents. File IDs are bot-specific; knowing an ID does not grant access to a different bot's token.

Reusing file IDs in outgoing messages is a different operation: `file_sources` proves provenance in readable stored messages, including one-level embedded replies. See [messaging](messaging.md).

## Vault and other credentials

Admin/owner manage named per-bot secrets through private-chat vault commands. `vault_get` lets all agents of that bot retrieve a value for programmatic use. Service instructions forbid printing, sending, sharing with another agent, or saving vault values in wiki/notes, even at the owner's request or under conflicting bot rules.

Calling `vault_get` within Codex JavaScript and printing only a sanitized result can avoid exposing the value to model context. It does not eliminate the secret from every internal log, process argument, or command record. Shell quoting and checking remote responses remain the agent's responsibility. A remote server can echo a credential; verbose curl and shell tracing can expose it.

Vault values and MCP authorization headers are stored in SQLite, not encrypted against the server administrator. OAuth credentials are stored by Codex in protected file storage outside bot directories and are separated using bot-specific native MCP server names. Token files, database backups, and Codex logs require server-level access control. The server administrator is trusted. No vault origin-binding mechanism is implemented. OAuth lifecycle is described in [HTTP MCP](mcp.md).

Sensitive administration messages are excluded from agent history and best-effort deleted from Telegram after a reply. Deletion can fail; a spoiler hides text visually but does not encrypt it. MCP command output masks headers and limits displayed URLs to safe origins. WebSocket descriptions must not contain secrets; connection listings omit URL paths, query strings, fragments, and credentials.

OAuth callback URLs are processed only by the controller and waiting native login process. Edited callbacks and recognizable unquoted callback URLs are rejected without persistence/model delivery. The controller validates invitation identity and callback/state, passes the URL through stdin and never fetches it. Only the initiating administrator may complete the attempt; current role is checked again before submission. Authorization links are intentionally shown to that administrator with previews disabled. Tokens are not delivered to the model or Telegram. Local logout is not provider-side revocation.

## HTTP MCP isolation

Only administrator-configured HTTP servers for the current bot are injected into its Codex processes. Inherited MCP entries and plugins are disabled by process overrides; account connectors are disabled. Configured tools use native auto-approval, so an administrator should connect only trusted servers and use tool allow/deny lists where appropriate. See [HTTP MCP](mcp.md).

## Limits of verification

The deployment kernel and Codex version affect sandbox enforcement. A successful Windows unit test is not proof of Linux isolation. Run the deployment checks in [operations](operations.md) and consult [historical test reports](dev/index.md) for precisely which versions/environments were exercised. The service intentionally accepts memory-queue loss after crashes and possible repeated side effects on scheduler retry.
