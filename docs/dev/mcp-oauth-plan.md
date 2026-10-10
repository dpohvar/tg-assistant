# MCP OAuth implementation plan

**Goal:** Let a bot administrator authorize one external account per bot MCP connection through Telegram, without a public callback server.

**Architecture:** Keep OAuth discovery, PKCE, token exchange, refresh and credential storage in Codex. A controller-owned manager starts `codex mcp login NAME --no-browser`, holds a bounded pending attempt, and supplies a validated callback URL from a reply to the administrator's original command. Native server names retain bot-specific namespaces.

**Stack:** Node.js child processes, native Codex CLI, existing SQLite MCP configuration and Telegram command routing.

**Spec:** Agreed discussion and [manual callback probe](mcp-oauth-probe.md). Implement `/mcp auth NAME` and `/mcp logout NAME`, administrator-only in private child-bot chats. Callback must reply to the caller's own unedited command in the same chat. Pending attempts expire after ten minutes, are replaced by a new login, and do not survive application restart. Existing tokens survive. Configuration replacement/deletion cancels pending login and removes local credentials. Refresh agents after successful login/logout using the existing idle boundary. OAuth URLs never enter agent history and callback messages have deletion attempted.

## Work

- [x] Tests first: command permissions, reply ownership/edit/suffix/formatting, sensitive deletion, pending login replacement, callback/state validation, bounded output/timeouts, process shutdown, namespace isolation and logout.
- [x] Implement a focused OAuth process adapter and pending-attempt manager. Use file credential storage consistently for login, logout and agent/test runtimes. Do not fetch submitted URLs or expose raw process output.
- [x] Integrate controller lifecycle, commands and detailed English help. Add narrowly validated native OAuth client configuration only where runtime support is established.
- [x] Build a reproducible local OAuth/MCP live fixture and test real Codex on Alpine, including refresh, fresh processes and two bot namespaces.
- [x] Update English MCP/command/security wiki, run full Windows suite and relevant Alpine tests, review the branch, and prepare the running test bot for manual acceptance.

## Review focus

- A delayed callback for a replaced attempt must not reach the new attempt.
- Role revocation and edited/foreign invitation replies must fail without model delivery or credential disclosure.
- Logout/configuration deletion must not erase another bot's credentials.
- Shutdown/timeouts must terminate login children and settle controller operations.
- Real providers can require pre-registered OAuth clients or disallow loopback redirects; the synthetic fixture is not external-provider acceptance.

## Execution notes

Work is isolated on `feature/mcp-oauth` in the existing linked worktree. Main was verified at 4107125. No application schema migration is needed: tokens remain in controller-only Codex storage and pending attempts are in memory.

JSON single-entry aliases and confidential client secrets were added for the approved Antigravity-style configuration. Native Codex 0.159.3 requires `oauth.client_secret`, not `client_secret_env_var`; server-admin-visible process arguments follow the existing explicit-header trust model.
