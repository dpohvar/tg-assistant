# Group file commands and help aliases

Approved scope: `/help COMMAND` resolves to the existing available section containing that slash command (for example ls/cat/download/upload/edit/mv/rm -> file), without duplicate index entries or exposing unavailable sections. Existing section names keep precedence.

All seven file-section commands and both reading/replacing bot-wide rules are available to application admin/owner in child-bot private chats, groups and supergroups. Existing argument/path validation, forum topic handling and ordinary/ephemeral response routing remain intact. Ephemeral output must never fall back public. Other administration scopes (Git, temp, users/ownership, vault, MCP and master bot) are unchanged.

Implementation uses the current help catalogue and administrative allow-list; no migrations, dependencies or new controller tools.

- [x] Add RED coverage for command aliases, role-scoped lookup, full group file/rules help and actual group file effects/downloads/rules documents.
- [x] Resolve help targets against available section commands; expose full file/rules sections and expand the existing group administrative allow-list.
- [x] Verify native private document replies/topic, ordinary compatibility, role denial and path restrictions through real handlers with only Telegram mocked.
- [x] Update commands/security documentation and English embedded help.
- [x] Run focused and full suites plus wiki/whitespace checks; independently review the change.
- [x] Report evidence and preserve the worktree. Live acceptance passed; the user explicitly authorized commit and push to main.
