# Browse verification

Implementation: `feat/browse`, based on `origin/main` `f126542`. The user approved committing and publishing the completed change directly to `main` after exercising the test bot and refining its navigation.

## Automated checks

- Baseline: 775 tests; 765 passed, 10 skipped, zero failed.
- Final Windows suite: 810 tests; 800 passed, 10 skipped, zero failed. Skips concern existing platform/external fixture requirements, not new browse tests.
- Focused browse and document-download suites: all 35 passed. Tests exercise actual scoped files, SQLite roles, actual controller/command routing, rich request payloads and filesystem effects; Telegram is replaced only at the transport boundary.
- Documentation checker passed: 20 wiki articles, 586 local links, 18 JSON examples, 55 controller tools. Syntax, UTF-8 and whitespace checks passed.
- No new dependencies, database migrations, production configuration changes or changes to `/ls` behavior.

Coverage includes a clickable `📁 ..` entry on every non-root directory page without changing totals, directory/file breadcrumb icons, fixed centered five-button directory navigation (including empty/last pages), active green navigation icons with unstyled disabled controls, five-position sibling-file gallery navigation, disabled gallery edges, parent-page restoration and literal code paths, missing-directory/root behavior, unsafe path/filename/symlink boundaries, 2048-byte/50-line preview limits and language, independent ZIP extraction and empty directories, merge/replacement/cancel, changed confirmations, newly appeared destinations, Windows case aliases, per-entry deletion revalidation, native ordinary/ephemeral routing without an agent, stale/foreign callbacks, role revocation, clipboard/cache transfer, upload target preservation across message replacement, unknown-delivery fencing and optional-image rejection fallback.

Real local HTTP regressions verify that a document body which started but stalls is aborted on stop, and actual streamed bytes cannot bypass the browser upload limit by lying about metadata.

## Independent review

Five Important findings were reproduced and fixed with regressions: protected descendants in recursive deletion; concurrent destination changes; Windows casing self-copy; stale media after partial mutations; and rejected image previews blocking download. A subsequent harness review found an unabortable file-body request, now covered by the HTTP regressions. Focused recheck reported no remaining Critical or Important findings.

## Manual test runner

`node test/manual/browse-acceptance.mjs PRIVATE_CONFIG COMPLETED_GROUP_PROBE [SECONDS]` starts the actual controller with a disposable SQLite database and bot workspace, no model calls and a 30-minute maximum/default lifetime. It verifies test-bot identity, an observed group and bot membership, refuses an active webhook and takes the shared exclusive bot lock. It backs up and restores all six group command lists and the update inventory. It accepts only the configured tester, designated private/group routes, browse callbacks, relevant commands and document replies. Shutdown aborts requests, waits for work, restores configuration and removes only runner-created messages. No group leave or production-data mutation occurs.

Fixtures: `wiki/sample.py`, `wiki/long-lines.txt`, `wiki/too-large.txt`, valid `wiki/image.png`, malformed `wiki/broken.jpg`, 24 entries under `wiki/pages`, and a conflicting `target/wiki` directory with a file that must survive merging.

Use `/browse` in the bot's private chat or `/browse@BOT_USERNAME` in the designated group. Stop with `/baccept stop RUN_ID` or create the run directory's `stop` file. Native command-list refresh may lag; explicit bot addressing is available.

## Live evidence boundary

Test-bot identity, lack of webhook, designated group type and ordinary bot membership were verified before startup. The user exercised the native test bot, requested navigation refinements, and approved the final result. The controller observed real commands/callbacks without model turns. The exact client/platform and a complete per-feature manual matrix were not recorded; Android-specific layout and file-ID/cache behavior are not separately certified. Automated coverage remains distinct from the user's acceptance. The final bounded runner was stopped normally, with all six command-list backups restored; no production data was modified. No Alpine verification is claimed for this change.

## Gallery refinement

File navigation now traverses all accessible sibling files, skips directories, displays a one-based file position and returns to the listing page containing the selected file. Navigation icons are `↩️ ◀️ ▶️ 🔄`, active panel controls use `success`, Root uses `🏠`, and full paths are rendered as native inline code. Dedicated tests cover refresh after sibling changes, stale file-to-directory replacements and clearing the prior visible download. A full run also exposed rounded Windows inode identities; exact BigInt stats and nanosecond version strings resolve this, with a deterministic regression for adjacent identifiers above 2^53. Independent follow-up review found no remaining material issues. The updated native gallery/green styling still awaits the user's client check; original-version acceptance is not a claim about this refinement.
