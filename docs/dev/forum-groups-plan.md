# Forum group communication implementation plan

> **Execution:** Approved for sequential execution and merge/push in this session on 2026-10-11. See [verification](forum-groups-verification.md) for completed work, evidence and manual acceptance limits.

> **For agentic workers:** Use superpowers:executing-plans for sequential implementation, or superpowers:subagent-driven-development if the user selects delegation. Track the checkboxes below. No product implementation, commit, merge or push is authorized by the request to write this plan alone.

**Goal:** Allow one existing chat agent to communicate across forum topics, with topic-aware history, delivery and independent loud-mode counters.

**Architecture:** Keep agent identity and operational queue scoped to the whole chat. Add a persistent topic registry and a shared topic-normalization module; integrate them into message persistence, history, outgoing actions and controller event admission. Follow Telegram's verified reply routing rather than inferring a destination from the most recent incoming event.

**Tech stack:** Existing Node.js, SQLite and Telegram Bot API. No new dependency. Deployment validation on Alpine Linux; local automated validation on Windows.

**Spec:** [Discussion and live evidence](forum-groups-discussion.md). The final contract below takes precedence over historical proposals in that protocol.

## Final contract

- One agent per bot/chat, not one per topic. Notes, model, schedules, lifecycle and queue remain shared.
- New forum groups are passive until `/agent start`; application manager/admin/owner may add the bot, with existing role checks.
- Converting a connected group to a forum preserves agent state and stored data. No leave or destructive reset.
- Short forum messages, edits, callback events and assembled albums expose `topicId`. General is normalized to 1. Ordinary newly received non-forum messages omit the field; historic forum messages retain it.
- Full `read()` preserves native JSON and existing ISO-date conversion. No fabricated native `message_thread_id` for General.
- `send`, `copy` and `forward` accept an optional positive integer `topicId` for the destination. It never changes the source or access scope. Native parameter is `message_thread_id`, except General: omit it.
- With neither topic nor reply, native sending targets General. Without topic but with reply, Telegram may use the original topic. Explicit non-General destination allows cross-topic reply. No automatic retry or fallback.
- Explicit General with a known reply to another topic must return a useful argument error rather than silently deliver to that other topic. If source topic cannot be determined locally, refuse this explicit combination with an explanatory error; the agent can remove reply. Omitted topic with reply remains valid and follows native routing.
- Agent instructions recommend replying in the source topic explicitly, explain General/default/reply behavior, and explain `external_reply`. Never assume `reply_to_message` is always the requested original: it can instead be the destination topic's creation message.
- `history`/`search` accept topic filters even when forum mode is off. No filter preserves whole-chat behavior. Filter before slicing history; validate anchor belongs to the selected topic. Preserve filters in search cursor. `read` still needs only chat/message IDs.
- Messages without a forum topic belong to normalized General for a topic-1 history filter, including messages from the period when forum mode was off. Non-forum discussion-thread IDs must not become forum topic IDs.
- `topics({chatId?})` returns `{enabled:boolean,topics:[{topicId,name,closed?,hidden?}]}`. Default chat is current; read-access check matches history. Unknown name is null; unknown states omitted. `hidden` exists only for General. General uses known renamed name, otherwise fallback `General`.
- Topic names and states are last-known, not a guaranteed current/full server catalog. Harvest received creation/edit events and embedded originals; do not let an old embedded creation overwrite a newer rename. No Bot API deletion event exists. Failed send is not proof of deletion.
- Keep registry until chat-data deletion, independent of 30-day history retention, agent stop/clear and forum-mode toggles.
- Topic service events persist and update registry without model dispatch, loud-mode activation or queue/counter consumption.
- Loud mode remains 2 minutes / 10 messages per topic; ordinary chat has one bucket. Pending historyGap is per topic, cleared only by delivery in that topic. Shared chat queue cap remains 10, including callbacks and one collected album; schedules/interagent messages are excluded as before.
- Command replies stay in the invoking topic and keep their reply relationship. Agent/task failure notices use General without reply and include existing IDs. Tasks remain chat-agent tasks; no compulsory topic/creation-origin field.
- Forum mode is last-observed metadata, not guaranteed instantaneous. Do not add getChat before every call. A current ordinary-group observation means topic-directed writes are invalid; historical reads remain allowed.
- Topic administration, React handlers and private-chat topic mode are outside scope.

## Review points requiring plan approval

The earlier forum-off proposal was not accepted as a whole. This plan retains its noncontroversial preservation behavior and proposes: on forum disable, reset topic loud timers and merge all pending topic gaps into one chat gap; on re-enable, move an existing ordinary bucket/gap to General. No model context is automatically cleared merely because forum mode changes. Review these transition details before execution.

Operational IDs and credentials stay out of tracked files. Source code changes will use an isolated feature branch; unrelated React protocol files remain untouched. Existing working tree is `C:/PROJECTS/tg-assistant-vault`; primary checkout has unrelated untracked files and must not be reset or pulled blindly.

## Review focus

1. A reply can override an omitted topic; explicit General must not be falsely reported as achieved.
2. Ordinary discussion threads also have message_thread_id; only forum metadata establishes forum membership.
3. Older embedded service messages and outgoing reconstructed records must not roll back current names or forum mode.
4. A queued batch can contain several topics; attach historyGap once per affected topic, not once per batch.
5. Upgrading an existing DB and retaining historical topics must not delete agent data or depend on topic creation roots surviving retention.

## File structure

| File | Responsibility |
|---|---|
| `src/telegram/topics.mjs` (new) | Pure normalization, destination validation, service-event recognition |
| `src/storage/topics.mjs` (new) | Registry ingestion, timestamp-aware updates and ordered listing |
| `src/storage/migrations/011.sql` (new) | Add message topic index and topic registry |
| `src/storage/database.mjs` | Upgrade ceiling, persistence/backfill integration, chat migration |
| `src/agents/history.mjs` | Topic filters and anchor/cursor behavior |
| `src/messages/actions.mjs` | send/copy/forward normalization and copied-record reconstruction |
| `src/controller.mjs` | Remove forum rejection, mode transitions, event topic routing and gap/loud buckets |
| `src/telegram/short-message.mjs`, `src/telegram/albums.mjs` | Topic-aware short records and album association |
| `src/commands/router.mjs` | Explicit topic in command text/file replies |
| `src/codex/threads.mjs` | Tool schemas/descriptions and developer instructions |
| `test/integration/forum-*.test.mjs` (new) | Focused migration, metadata, history, actions and controller regressions |
| `test/live/forum-topics.mjs` (new) | Reusable opt-in probe, credentials from private file, no second poller |

## Task 1: Canonical topic normalization and additive migration

**Files:** Create `src/telegram/topics.mjs`, `src/storage/migrations/011.sql`, `test/integration/forum-topics.test.mjs`; modify `src/storage/database.mjs`, `test/integration/migrations.test.mjs` and `docs/storage.md`.

**Interfaces:** `topicIdOf(message)` returns a positive topic ID for messages with `chat.is_forum===true` (native ID or General 1), otherwise null. `topicFields(message)` returns `{topicId}` or `{}` for short events. Store `messages.topicId` as native normalized forum affiliation or NULL; a topic-1 filter also selects NULL, by contract.

- [x] Write RED tests for forum General, ordinary forum topic, non-forum discussion with a thread ID, and plain/private messages. Example assertion:

```js
assert.equal(topicIdOf({chat:{is_forum:true},message_thread_id:42}),42);
assert.equal(topicIdOf({chat:{is_forum:true}}),1);
assert.equal(topicIdOf({chat:{type:'supergroup'},message_thread_id:42}),null);
```

- [x] Run `node --test test/integration/forum-topics.test.mjs`; confirm failures concern missing behavior.
- [x] Add migration 11: nullable message topic column; index `(botId,chatId,topicId,date,messageId)`; registry keyed `(botId,chatId,topicId)` with FK to chats ON DELETE CASCADE, nullable name/closed/hidden plus per-field observation timestamps. Do not rewrite native JSON. Backfill existing normalized IDs from JSON only for messages whose own chat.is_forum is true.
- [x] Bump migration loop/ceiling from 10 to 11. Migration remains inside existing transaction. Add tests opening a schema-10 fixture twice, preserving agents/notes/tasks/messages and rejecting future schema. Include rollback on failure and isolation of equal topic IDs across chats/bots.
- [x] Persist topicId for new/edited records; extend `migrateChat()` to move topic rows atomically. Keep cross-chat migration collision checks.
- [x] Run `node --test test/integration/forum-topics.test.mjs test/integration/migrations.test.mjs`; update storage migration documentation. Commit only when authorized.

## Task 2: Durable topic registry and topics tool

**Files:** Create `src/storage/topics.mjs`, `test/integration/forum-registry.test.mjs`; modify `src/storage/database.mjs`, `src/controller.mjs`, `src/codex/threads.mjs`, `test/integration/retention.test.mjs`, `docs/agent-contract.md`, `docs/storage.md`.

**Interfaces:** `createTopicStore(db)` provides `observeMessage(botId,message)` and `list(botId,chatId)`; listing result is `{enabled,topics}`. Controller performs `access.assertRead` before list. Registry sorts by numeric topicId, includes normalized General for known forum/former-forum groups, and does not invent a forum for private chats.

- [x] Write RED cases for unknown-name topic, fallback/renamed General, close/open, hide/unhide implications, unknown states, and a nested creation older than known rename. Verify no false deleted state on failed sends.
- [x] Run `node --test test/integration/forum-registry.test.mjs`.
- [x] Implement observation of top-level and one-level embedded service messages; field timestamps prevent older data replacing newer names/states. Only current observed chat envelopes update mode; nested old messages do not. Missing is_forum in a current ordinary chat is an actual mode-off observation, not a reason to destroy registry. Avoid resetting metadata due to reconstructed outgoing copy records.
- [x] Integrate persistence for incoming and actual native sent responses. Add `topics` schema `{chatId:{type:'integer'}}` and dispatch via read-access checks. For inaccessible/unconnected chat return existing access error; never reach another private chat's registry.
- [x] Add retention and lifecycle regression tests: registry survives message cleanup, stop/clear and mode-off; leaving/chat deletion cascades registry; DB reopen retains metadata. Populate old-message metadata during upgrade in chronological order, not on every request.
- [x] Run registry, retention and existing history-access tests; document names as observed through creation/rename, including embedded originals, not fetched as a complete Telegram list. Commit only when authorized.

## Task 3: Topic-aware events and history filtering

**Files:** Modify `src/telegram/short-message.mjs`, `src/agents/history.mjs`, `src/codex/threads.mjs`; create `test/integration/forum-history.test.mjs`; extend `test/integration/history-access.test.mjs`, `docs/message-events.md`, `docs/agent-contract.md`.

**Interfaces:** Optional positive integer topicId in history/search. `read` unchanged. Search cursor signs/preserves topicId in the existing filters object.

- [x] Write RED mixed-history fixture: General, topics 42/87, ordinary period and discussion-thread message. Test topic filter before history slicing, matching/nonmatching anchor, chronological order, mode-off access, cursor continuation and unauthorized chat.

```js
assert.deepEqual(history.history(scope,{
  topicId:42,messageId:null,from:-2,to:0
}).messages.map(m=>m.topicId),[42,42]);
```

- [x] Run `node --test test/integration/forum-history.test.mjs`.
- [x] Add normalized topicFields to short messages; preserve historical forum topic fields based on the saved message, not current chat mode. Full read retains native fields and embedded/external replies.
- [x] Select topic rows before computing anchors/ranges. Topic 1 includes topicId=1 or NULL; other values match exact column. Validate positive integers and retain whole-chat behavior without filter. Combine topic and discussion filters as intersection rather than bypassing discussion access/root checks.
- [x] Add schemas and descriptions; prohibit combining cursor with any new filter as before. Test legacy no-filter behavior and cursor-boundary ordering.
- [x] Run new history tests plus `history-access`, `history-gap` and `codex` tests. Update tool/event examples. Commit only when authorized.

## Task 4: send/copy/forward destination routing

**Files:** Modify `src/telegram/topics.mjs`, `src/messages/actions.mjs`, `src/codex/threads.mjs`; create `test/integration/forum-actions.test.mjs`; extend `test/integration/message-actions.test.mjs`; update `docs/messaging.md`, `docs/agent-contract.md`.

**Interfaces:** `destinationFields({chat,topicId,replyMessage})` supplies native thread fields or a safe invalid_argument. Undefined topic means native omission; 1 means omission with explicit-General reply validation; >1 maps to message_thread_id. Strip the application topicId from all native payloads.

- [x] Write RED capture-telegram tests for omitted destination, General, explicit other topic, reply inheritance and explicit-General conflict. Preserve delivery_unknown handling and ensure failure triggers exactly one call, never a fallback.

```js
await messages.send(scope,{text:'Hello',topicId:1});
assert.equal(Object.hasOwn(calls.at(-1).args,'message_thread_id'),false);
assert.equal(Object.hasOwn(calls.at(-1).args,'topicId'),false);
```

- [x] Run `node --test test/integration/forum-actions.test.mjs`.
- [x] Apply destination helper to every send kind, rich multipart and media groups. Validate known mode-off destination before uploads/effects. Do not require topic registry membership: missing registry is not proof the topic is invalid.
- [x] Apply helper to single/batch copy and forward; preserve source read/write checks and existing disallowed parameters. For reconstructed single copy save destination topic metadata from effective destination/source reply, not the copied source topic. Do not invent guaranteed stored records for batch methods that only return IDs.
- [x] Keep edit/delete/pin/unpin/react unchanged. Test all method families using table-driven fixtures, invalid integer types, passive destination scope and failed sends to missing topics.
- [x] Run forum-actions, message-actions, upload-reply and rich-help tests. Document native reply inheritance, General normalization and no controller retry. Commit only when authorized.

## Task 5: Forum admission, command replies and mode transitions

**Files:** Modify `src/controller.mjs`, `src/commands/router.mjs`; create `test/integration/forum-controller.test.mjs`; extend `test/integration/commands.test.mjs`, `test/integration/command-contract.test.mjs`; update `docs/channels-and-discussions.md`, `docs/commands.md`, `docs/agents.md`.

**Interfaces:** Existing one-agent lifecycle unchanged. Observe current chat metadata before routing actions; service messages persist before returning without admission to model queue.

- [x] Write RED tests for owner/manager admission, unauthorized inviter rejection, passive new forum, agent start from any topic, enabled group converting to forum without data loss and mode-off/on transitions preserving IDs/notes/tasks/model.
- [x] Run `node --test test/integration/forum-controller.test.mjs`.
- [x] Remove all destructive is_forum branches from observedChat, membership, migration and message handlers. Preserve all unrelated authentication, channels/passive and stop/delete checks. Mode change must not create another agent or reset context automatically.
- [x] Add explicit native topic to both plain/formatted command replies and file replies, derived from invoking message. General omits native field. Cover syntax errors and replies requiring file upload, not only successful text commands.
- [x] Ensure root agent failure/task failure notices use native destination omission with no reply, include IDs and remain best-effort with server diagnostics. Tasks themselves gain no new ownership/required-topic field.
- [x] Apply approved transition semantics at observed mode change. Merge pending gaps on disable and map ordinary gap to General on enable; avoid changing state based on old embedded chat metadata. Recognized topic service events update storage without model triggering.
- [x] Run controller/command tests and existing lifecycle/scheduler regressions. Update user wiki to remove the forum prohibition, explain one agent and historical topics. Commit only when authorized.

## Task 6: Per-topic loud mode and historyGap, shared queue

**Files:** Modify `src/controller.mjs`, `src/telegram/albums.mjs` if needed; create `test/integration/forum-queue.test.mjs`; extend `test/integration/history-gap.test.mjs`, `test/integration/albums.test.mjs`, `test/integration/buttons.test.mjs`; update `docs/agents.md`, `docs/message-events.md`.

**Interfaces:** Bucket key includes bot/chat and normalized topic for forum events; ordinary chat uses a dedicated no-topic bucket. clearChat clears all matching buckets. Operational AgentQueue stays keyed by agentId.

- [x] Write RED fake-clock tests with topics 42/87: trigger only activates its own topic; independent 120000 ms/10-message budgets; one queue cap of 10; callback rejection at capacity; one assembled album admission.
- [x] Run `node --test test/integration/forum-queue.test.mjs`.
- [x] Replace loud/gap chat-only keys in delivery, callbacks, dropped-event hooks, stop, deletion and migration. Album association must not mix topics; callback topic comes from saved message (incoming inaccessible callback message is not sufficient metadata).
- [x] Rewrite addGapHint to process each topic represented in a delivered batch. Mark at most the first eligible event per pending topic; other topics' gaps remain pending. Preserve existing loud-mode suppression behavior where applicable and album boundary rule.
- [x] Test delayed admission/expiration and dropped mixed-topic batches, disabled agent, trigger reasons, active edited messages, stop/start and mode switching. Ensure service messages consume neither counters nor queue slots.
- [x] Run new queue tests plus albums/history-gap/buttons/button-disabled. Update queue examples. Commit only when authorized.

## Task 7: Instructions, live probe and final verification

**Files:** Modify `src/codex/threads.mjs`, `test/integration/codex.test.mjs`, relevant English wiki articles and `docs/dev/index.md`; create `test/live/forum-topics.mjs`, `docs/dev/forum-groups-verification.md`.

- [x] Add instruction assertions for source-topic answers, topics metadata freshness, General ID translation, external_reply, inherited reply direction and manual fallback. Explain schedules can target any topic through their self-contained text.
- [x] Run `node --test test/integration/codex.test.mjs`; keep instructions compact and avoid repeating the entire protocol. For already-running deployed contexts, document `/agent clear` refresh after upgrade rather than silently clearing user context. Verify tools on native start/resume; if resume lacks newly configured tools, document/reset through the existing safe clear path before acceptance.
- [x] Convert the temporary probe into an opt-in live helper. Token/config paths come from arguments/private files; logs remain ignored. Do not start a second getUpdates consumer. Stop normal controller before raw probe, then close raw probe before application acceptance. Never restart the old forum-rejecting controller while the test bot remains in the forum without explicitly arranging removal or deployment of the new code.
- [x] Run `npm test`, `node docs/dev/check-wiki.mjs`, `git diff --check`; inspect each result and count passed/skipped honestly. No repeated full suite unless subsequent changes justify it.
- [x] Run relevant forum/migration/controller tests inside Alpine Docker using the planned runtime/sandbox configuration. No claim that Windows-only tests prove deployed isolation.
- [ ] Deploy feature build on isolated test config/DB backup. Verify one agent across General/two topics, send/rich/file/album, callback topic, command reply and filtering with forum off. Repeat General/other-topic routing in Tabs/List, cross-topic reply, missing/deleted topic and off/on ID preservation. Existing raw tests are evidence for API, not application acceptance.
- [ ] Ask user only for Telegram UI actions unavailable through Bot API (layout/forum toggles and visual checks). Test 10-event capacity and per-topic gaps/counters with a controlled busy agent. Registry retains name after history retention; a nested old creation does not overwrite renamed topic.
- [x] Write verification report distinguishing automated, synthetic, live native and live application results. Ensure no token, personal history or machine-specific runtime data is tracked.
- [x] Review complete diff for spec coverage, access/privacy regression, mode preservation and instruction/schema alignment. Commit/integrate/push only following the user's execution/integration authorization.

## Completion criteria

- Existing schema-10 DB upgrades transactionally with no loss of agents, notes, schedules or history.
- Forum admission no longer deletes connected data; one shared agent communicates in topics in both layouts.
- Topics registry and filtered history remain usable after mode-off and retention as specified.
- Every sending method and controller command follows native topic/reply routing without silent misdelivery or automatic duplicate retry.
- Independent loud/gap state coexists with unchanged shared 10-event cap.
- Relevant Windows/Alpine automated gates and bounded live application checks pass; remaining manual checks are explicitly reported.
- English wiki describes current feature rather than development history; protocols/reports stay in docs/dev.

## Self-review and execution handoff

Coverage checked against all 13 recorded decisions and live tests. The five review-focus risks are explicitly exercised by tasks 1–6. No product code changed while writing this plan. Review the transition proposal and explicit-General reply validation in this document; after approval, choose sequential execution or delegated implementation. Repository-wide refactoring and new topic-administration tools are excluded.

Execution note: queue/album/button regressions were consolidated into `test/integration/forum-controller.test.mjs`. Real-model start/resume and routing were checked in an isolated Alpine config; interactive layout/toggle UI acceptance remains separate as documented in the report.
