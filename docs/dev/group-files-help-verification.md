# Group file commands and help aliases verification

## Scope

The current-role help catalogue now resolves a slash command name to the existing section containing it. For example, ls/cat/download/upload/edit/mv/rm all resolve to file. Section names keep precedence, unknown or unavailable names fail uniformly, and aliases do not duplicate the help index.

The existing group administrative allow-list now admits all seven file-section commands and reading rules, in addition to the previous upload/rules replacement support. Application admin/owner is still required. Git, temp, user/owner, vault and MCP scopes are unchanged. There are no schema migrations or dependencies.

## Automated evidence

Baseline with the unchanged Wordle archive: 721 total, 713 passed, 8 skipped, zero failures. New tests were run against the old behavior and failed for unavailable aliases and group file/rules restrictions before implementation. The focused four-file suite passed all 53 tests after implementation.

Real SQLite authorization, command parsing, help rendering, file commands, BotFiles validation and ephemeral reply routing are used; only Telegram is replaced at the external transport boundary. Coverage includes actual list/read/write/move/remove effects in groups and supergroups, private document downloads/rules in forum topic 7, ordinary document-route compatibility, denial for manager/user/unassigned senders, path traversal/protected paths, alias equivalence with full file help, role-filtered lookup and inherited object-property names. Existing upload invitation, rules-update, delayed-private-reply and shutdown checks remain in the focused run.

Fresh Windows full suite with the unchanged Wordle archive: **730 tests, 722 passed, 8 skipped, zero failures**. Independent read-only review found no material Critical, Important or Minor issues and checked a role/alias matrix. The wiki checker validated 20 articles, 562 links, 18 JSON examples and 55 controller tools; git diff --check passed. Alpine 3.24.2 / Node 24.18.1 under ordinary UID 1000 also passed the full suite: **730 tests, 727 passed, 3 skipped, zero failures**. The export-only askpass shebang was normalized to LF for Linux; tracked code was not changed.

## Live runner

`test/manual/group-file-acceptance.mjs PRIVATE_CONFIG COMPLETED_GROUP_PROBE [SECONDS]` reuses the bounded ephemeral-command acceptance transport, recorded command-list backups, observed-group/owner input scope and cleanup. The default/maximum run is 30 minutes. It admits only file/help/rules command families for this case, with mutations confined to the isolated test bot directory. Stop through its stop file or `/faccept stop RUN_ID` in the designated private chat. It never leaves the group.

## Live acceptance and final gate

The user confirmed the designated test-bot run passed in the previously observed group: command-name help aliases returned file help, the prepared text file downloaded, and rules were delivered as a document. Five native ephemeral commands produced three private text replies and two private document replies, with no processing placeholders, model calls or recorded errors. The bot was an ordinary Telegram member and the invoking account had application admin role. File mutation commands were covered by automated tests; no live mutation pass is claimed.

The bounded runner exited successfully. Independent Telegram read-back confirmed all six command-list backups restored and bot membership unchanged. Its exclusive lock was released, no message-ID-zero history entries were present, and cleanup reported no errors. A fresh full Windows run after adding the manual fixture again passed 730 tests: 722 passed, 8 skipped, zero failures. The user then authorized committing and pushing this change to main.
