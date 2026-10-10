# Repository instructions

## Project documentation

- Treat [docs/index.md](docs/index.md) as the entry point to the project wiki. Read the articles relevant to the task before proposing or changing behavior.
- Keep the wiki accurate in every task. Update the affected articles in the same change as modifications to commands, tools, configuration, data lifecycle, permissions, dependencies, or operational behavior. If a task does not affect documented behavior, state that no wiki update was needed in the completion report.
- Write `README.md`, this file, and the project wiki in English. Use thematic articles that describe the current implementation, with concrete examples and explicit limitations. Do not append dated discussion transcripts or superseding decisions to wiki articles.
- Write controller command replies, status labels, prompts and errors in English, including child and master bots. Preserve user-supplied names and content in their original language.
- Keep only Markdown wiki articles directly in `docs/`. Put development plans, design discussions, experiments, audits, test reports, and historical documents under `docs/dev/`; these may use any language. Test programs belong in `test/`, and runtime modules belong in `src/`.
- Document master-bot administration only in [docs/master-bot.md](docs/master-bot.md). Keep child-bot commands in [docs/commands.md](docs/commands.md). Link to the canonical article instead of duplicating its command tables.
- Check documentation against the implemented schemas, command handlers, configuration, and tests. Distinguish live acceptance, automated tests, proposals, and historical evidence. Archived documents are not authoritative for current behavior.
- Maintain navigation and relative links when moving or renaming documents. Check example field names and command syntax before finishing. Do not put real tokens, credentials, personal chat history, or machine-specific runtime data into documentation.

## Working on the project

- Preserve unrelated local changes and user-created files. Use an isolated branch/worktree for substantial changes.
- Run verification appropriate to the change. For documentation changes, check local links, examples, and references from source and tests; run affected tests if those references change.
- Report what changed, which verification ran, any remaining limitations, and which wiki articles were updated.
- Commit, push, and merge only when authorized by the user. An explicit instruction to merge after successful verification is sufficient authorization.
