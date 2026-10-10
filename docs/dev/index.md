# Development archive

This directory contains development material, not the current project specification. The maintained English wiki starts at [../index.md](../index.md).

The original documentation was preserved under `archive/` during the wiki reorganization. Files retain their original language and historical claims. Later appendices may supersede earlier statements within the same document; use the current wiki and source code for present behavior.

| Material | Location |
|---|---|
| Original discussion and agent contract | [discussion](archive/discussion.md), [agent contract](archive/agent-contract.md) |
| Command redesign | [commands](archive/commands.md) |
| Plans | [initial implementation](archive/superpowers/plans/2026-10-07-v1.md), [agent commands](archive/superpowers/plans/2026-10-09-agent-state-and-commands.md), [browser/PDF](archive/superpowers/plans/2026-10-09-browser-pdf-read.md), [vault](archive/superpowers/plans/2026-10-10-vault-network-spoiler.md), [WebSocket](archive/superpowers/plans/2026-10-10-active-websocket.md), [HTTP MCP](archive/superpowers/plans/2026-10-10-http-mcp.md) |
| Runtime and platform probes | [Codex](archive/runtime-check-results.md), [Alpine](archive/alpine-check-results.md), [Telegram](archive/telegram-check-results.md), [Croner](archive/croner-check-results.md) |
| Later feature checks | [vault](archive/vault-check-results.md), [WebSocket and MCP](archive/websocket-mcp-check-results.md) |
| MCP OAuth | [Implementation task](mcp-oauth-plan.md), [verification report](mcp-oauth-probe.md) |
| Audits and progress | [contract review](archive/contract-review.md), [v1 audit](archive/v1-audit.md), [implementation progress](archive/implementation-progress.md) |
| Original rich-message examples | [JSON examples](archive/rich-message-examples.json) |
| Historical standalone probes | [Probe scripts](tools/index.md) |
| Example bot rules | [Minion](examples/Agents_Minion.md): an English AGENTS.md template for a personal and group assistant |
| Wiki validation | [check-wiki.mjs](check-wiki.mjs): run `node docs/dev/check-wiki.mjs` from the repository |

New development documents may be written in any language. Preserve historical evidence rather than rewriting it to claim newer behavior. Keep executable tests in `test/`; untracked local runtime files and credentials do not belong in this archive.

The legacy standalone probes were copied from the original development checkout so they are preserved in the repository. Its local originals were left intact. Personal bot-rule files remain excluded; the Minion template is a separately adapted, reusable example. Active application tests remain in `test/`; legacy probe copies are archival artifacts, not required service dependencies.
