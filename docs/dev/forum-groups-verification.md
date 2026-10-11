# Forum group implementation verification

Date: 2026-10-11. Scope: [approved plan](forum-groups-plan.md). Feature branch: `feature/forum-groups`; starting revision: `859114a`.

## Progress ledger

- Baseline Windows suite: 250 passed, 8 skipped, 0 failed.
- Normalization and additive schema 11 implemented. Initial normalization test failed because the module was absent; focused tests now pass.
- Registry records unknown names and observed states, protects newer renames from embedded originals, survives history removal and mode changes, and cascades on chat deletion.
- History test initially returned messages from other topics; topic filtering now happens before anchoring/slicing and remains in search cursors.
- Controller tests initially demonstrated destructive forum rejection. Forums now remain connected; loud/gap tests cover independent topics and mode changes with stable agent identity.
- First full suite found one stale schema-version assertion in the vault upgrade test; updating the expected supported version does not change vault behavior.
- Expanded tests cover shared callback/message capacity, albums counted once, retained callback affiliation, stop/clear registry retention, commands/errors/documents, and developer instructions.
- Independent whole-branch review found four important boundary cases: uncertain copied reply destination, same-second embedded names, mode observations in outgoing results, and pre-forum button buckets. All have targeted regressions and fixes.
- Live Alpine/controller/native Telegram probe passed: default/explicit General, explicit topic, reply inheritance, explicit-General guard, cross-topic external_reply, rich messages, single/batch copy and forward, embedded topic name, deleted-topic rejection without fallback. Only its own temporary topic and General probe messages were created/deleted. That deterministic API probe did not use a model; the separate Codex probe below did.
- Alpine transfer troubleshooting: the first run used root and was rejected by the production-user assertion. Repeating as uid 1000 exposed CRLF in the tar-copied askpass shebang; converting this transferred file to LF made the Git handshake pass. Product Git files are unchanged and a normal Linux Git checkout uses LF.
- Final Windows suite: 278 tests, 270 passed, 8 skipped, 0 failed. Final Alpine suite as ordinary uid 1000: 278 tests, 275 passed, 3 skipped, 0 failed.
- Real Codex 0.159.3 on Alpine with the existing named tg-agent permission profile: synthetic authorized inputs produced real sends to two newly owned topics and General through one agent. Native start and detached-session resume both worked. All three routing assertions passed; temporary Telegram topics/messages were removed. No private production agent session or DB was reused.
- Wiki validation: 16 English articles, 317 local links, 15 JSON examples and 40 controller tools checked; diff whitespace check passed.
- Committed release artifact documentation check on Alpine: 16 articles, 314 local links, 15 JSON examples, 40 tools. The local worktree count above also includes unrelated untracked React discussion material, excluded from the release.
- Regular test service restored on the committed feature build after a SQLite backup; schema 11 opened successfully. Raw forum poller was stopped and its offset synchronized, leaving one normal application consumer. Service start/status both report running; the connected forum remains passive until `/agent start`.
- Integration uses a fast-forward of remote main. The primary checkout has overlapping untracked user files, so its working tree and local main are preserved.

Automated controller tests use a fake Telegram transport and fake model. They validate application behavior; they do not establish Telegram client rendering or real-model compliance. Prior live native API evidence is recorded in [the discussion](forum-groups-discussion.md).

## Remaining manual acceptance

No new user action blocks integration. Tabs/List rendering, forum toggles and topic deletion were verified manually with the earlier native probe; repeat them against the regular application if desired. New capacity/gap/mode-transition checks are deterministic controller tests, not claims of new manual UI acceptance. The real-model check uses synthetic inbound events and real outbound messages, not a user-authored Telegram conversation.
