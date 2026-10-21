# File media implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with regression tests before implementation. Do not commit, merge, push or send Telegram messages without user authorization.

**Goal:** Replace the agent-facing uploads map with file:path references in structured media fields, retaining native rich_message.media and passing HTML/Markdown unchanged.

**Architecture:** A shared structural media walker identifies only supported file positions. Preparation clones the request, translates file:path to generated attach:// names, and passes local declarations to the existing scoped file loaders. Widgets reuse the walker while retaining their render cache. Legacy uploads remain accepted internally during migration, but are removed from exposed schemas and current examples.

**Tech Stack:** Node.js ESM, node:test, existing BotFiles and Telegram multipart transport; no dependencies.

**Spec:** Approved conversation: retain media, remove uploads from the agent contract, use file: paths, never parse HTML or Markdown. Preserve current chat authorization and inline/guest upload prohibitions.

## Global constraints

- Work only in feat/file-media, based on origin/main 270cb63.
- Keep Telegram file IDs and HTTP(S) references supported; reject secret-bearing Telegram URLs.
- Resolve paths with BotFiles, preserving spaces and literal URL-like characters.
- Prepare all local bytes before any Telegram mutation; preserve stale-scope fences and delivery_unknown behavior.
- Update English wiki articles; do not modify historical reports.

## Review focus

- Ordinary photo objects must fail before file reads or Telegram calls.
- Nested rich content and HTML/Markdown media bindings must preserve the author's input.
- Captions, buttons, formatting entities and arbitrary metadata must not cause file reads.
- Failed file preparation must not publish a partial album/edit or a sticker creation intent.
- Inline/guest routes must not acquire hidden uploads or buffer sends.

### Task 1: Structured file preparation

**Files:** src/files/media.mjs, src/widgets/media.mjs, test/integration/file-media.test.mjs.

**Interfaces:** mapMediaSources(input, mapper, {kind}) mutates a caller-owned clone at supported media slots; mapper receives source, request path, media role and response path. prepareLocalMedia(input, local, {kind}) returns {value, local}, translating file: references into collision-free attachment names without reading files.

- [x] Add failing regressions for rich blocks, albums, HTML/Markdown bindings, literal text/metadata, invalid ordinary media objects and repeated sources.
- [x] Run node --test test/integration/file-media.test.mjs and confirm failures describe missing file preparation.
- [x] Implement the shared walker and preparation; use the walker from widgets without changing cache semantics.
- [x] Run file-media and widget-media/widget-render integration tests.

### Task 2: Controller routes and tool contracts

**Files:** src/messages/actions.mjs, src/ephemeral/messages.mjs, src/stickers/service.mjs, src/stickers/schema.mjs, src/codex/threads.mjs, src/messages/rich-help.mjs; affected integration tests.

**Interfaces:** Existing scoped uploads loaders consume prepareLocalMedia(...).local. Send/edit/sticker requests use prepared.value. No change to Telegram transport's internal uploads array.

- [x] Add failing controller-level tests for multipart byte content, all local-file failure before effects, ordinary edit, ephemeral send/edit, sticker uploads, legacy compatibility and schema removal.
- [x] Run the new tests and verify RED before route changes.
- [x] Integrate preparation before validation/loading/effects; preserve legacy declarations and existing error results. Remove uploads from public tool schemas, update descriptions and runtime rich help.
- [x] Run the new tests plus message-actions, ephemeral-agent-tools, sticker-sets, inline-results and guest-results tests.

### Task 3: Documentation and final verification

**Files:** docs/messaging.md, docs/agent-contract.md, docs/storage.md, docs/widgets.md and other affected current wiki articles; test/live/image-dialog.mjs and current manual examples as needed.

- [x] Update canonical examples to file:path; show rich HTML/Markdown using the retained media table. Explain internal legacy compatibility and unchanged inline restrictions.
- [x] Run npm test, syntax checks, local documentation-link checks and git diff --check. Compare with baseline.
- [x] Obtain one independent final code review; fix important findings with RED/GREEN tests and repeat the full suite if changed.
- [x] Report exact checks and limits, branch and worktree; leave changes uncommitted for user review.
