# Sticker sets implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task.

**Goal:** Give agents complete sticker-set tools and reusable custom emoji in messages/buttons.

**Architecture:** A focused sticker service handles native Telegram mapping and guarded multipart files. A bot-scoped SQLite registry retains confirmed creations and uncertain creation intents. Existing messaging/JSX handles rendering.

**Tech Stack:** Node.js >=24.18.1, node:sqlite, Telegram Bot API; no new dependencies.

**Spec:** [Accepted specification](sticker-sets-spec.md).

## Global Constraints

- All model agents have the tools; no additional role gate or behavioral instructions.
- Preserve bot/chat/path/lifecycle boundaries and unrelated work; use existing isolated worktree.
- Runtime text and maintained wiki in English. No live Telegram mutations in offline verification.
- Commit, merge to main and push after successful verification are authorized.

## Review Focus

- Unknown network outcome must not disappear or cause an automatic create retry.
- Native file-ID-only edits must not mutate a member of a different named set.
- Revocation during asynchronous metadata lookup must fence the following mutation.
- RichText labels containing nested text/custom emoji must survive grouped-button closure.
- Removing file provenance must preserve local-file and destination access boundaries.

### Task 1: Sticker service and registry

**Files:** src/stickers/service.mjs, src/stickers/schema.mjs, src/storage/migrations/014.sql, src/storage/database.mjs, src/controller.mjs, src/codex/threads.mjs; test/integration/sticker-sets.test.mjs.

**Interfaces:** `createStickerSets({db,telegram,filesFor,assertCurrent})` produces async `(scope,tool,args)` handler. `stickerSetTools` exports dynamic schemas shaped like existing tools. Results follow the specification.

- [ ] Write controller integration tests with real database and permitted files, fake Telegram only. Create both set types and verify owner/default, native input, catalog and downloaded bytes; exercise all edit endpoint payloads and membership checks. Exercise persistence, separate bots, malformed links/inputs, bad local paths, stale lifecycle, timeout intent and storage failure.
- [ ] Run `node --test test/integration/sticker-sets.test.mjs`. Expected: unknown tool errors before implementation.
- [ ] Implement schema 14 registry with bot FK, case-insensitive set key and pending/confirmed state. Implement native mappings, validation and pre-effect fencing with scoped multipart files. Expose five tools in controller and dynamic schemas.

```javascript
const result = await controller.invoke(scope, 'sticker_set_create', {
  name: 'Faces_by_bot', title: 'Faces', type: 'custom_emoji',
  stickers: [{sticker:'attach://face',format:'static',emoji_list:['🙂']}],
  uploads: {face:'wiki/face.png'}
});
assert.equal(result.status, 'created');
```

- [ ] Run the focused file again. Expected: all cases pass. Commit service, registry and tests.

### Task 2: File reuse and rich callbacks

**Files:** src/messages/actions.mjs, src/messages/callbacks.mjs, src/widgets/media.mjs, src/widgets/service.mjs, src/codex/threads.mjs; test/integration/message-actions.test.mjs, buttons.test.mjs and widget media/controller tests.

**Interfaces:** Message tools retain `file_sources` schema but ignore it. Rich button labels flatten to human-readable event `text`; original rendering retains RichText objects. Widget media accepts arbitrary Telegram file IDs.

- [ ] Replace provenance-dependent test with send/edit/rich reuse assertions; add rich grouped callback regression through real controller and widget raw-ID coverage.
- [ ] Run focused tests. Expected: file_not_accessible errors and `.replace` failure before fix.
- [ ] Remove provenance lookups, keep attachment/secret URL checks. Add structured label traversal and marker replacement, use it in callback events and closeButtons. Correct outdated tool description.

```javascript
const label = ['⬜️ ', {type:'custom_emoji',custom_emoji_id:'123',alternative_text:'🙂'}, ' Choose'];
// Event text: '🙂 Choose'; selected button: same nodes with first string '✅ '.
```

- [ ] Run focused tests. Expected: all pass. Commit code and regressions.

### Task 3: Documentation, review and integration

**Files:** docs/agent-contract.md, docs/messaging.md, docs/widgets.md, docs/storage.md, docs/security.md, docs/dev/index.md.

**Interfaces:** Maintained wiki describes shipped tool schemas, catalog uncertainty, creation formats, and file reuse without provenance. Existing Alpine dependencies remain documented.

- [ ] Update wiki with concrete create/inspect/send/custom-emoji-button examples, constraints and errors; link this spec/plan in archive.
- [ ] Run `npm test`, `node docs/dev/check-wiki.mjs`, `git diff --check`. Expected: zero failures, valid links/examples/schema references, clean whitespace.
- [ ] Request whole-branch independent review against spec, resolve material findings with regressions, then commit verified final tree.
- [ ] Fetch origin, integrate any new main commits and rerun affected/full checks as necessary. Push verified commit to main by fast-forward; preserve old main worktree and unrelated files. Verify remote main SHA equals intended commit.
