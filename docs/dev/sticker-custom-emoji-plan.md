# Sticker and custom emoji implementation proposal

> **For agentic workers:** Use `superpowers:executing-plans` after the user approves the desired scope. Checkboxes below describe proposed work, not completed implementation. Commit, merge and push require user authorization under the repository instructions.

**Goal:** Let the bot inspect the actual artwork of incoming stickers and custom emoji, with a fast static path and an optional frame sequence for motion.

**Architecture:** Retain native Telegram messages and the existing `read` → `download` → native image viewer workflow. Add custom emoji discovery and metadata lookup. If the user selects motion support, add a separate bounded renderer for downloaded TGS and WebM files; return image paths and timestamps rather than binary data in event JSON.

**Tech stack:** Existing Node.js, Bot API, BotFiles and Codex image viewer. Static support needs no additional dependency. Proposed motion support uses FFmpeg/ffprobe and a Lottie renderer; the renderer backend is a design choice described below, not an installed dependency.

**Design status:** Historical investigation and alternatives. The user subsequently confirmed that system FFmpeg and `lottie_to_png` already let the agent inspect animations, and requested custom emoji downloading, brief agent guidance, and Alpine installation documentation. The current implementation adds `download_custom_emoji({customEmojiIds})`, which resolves metadata and downloads original files through the existing cache. It keeps short events unchanged and uses system rendering utilities when needed. There is no automatic inspection, new in-process renderer, or new npm dependency. The earlier alternatives and unchecked tasks below record the original proposal, not outstanding approved implementation work.

## Verified repository baseline

- Base: `origin/main`, commit `02456eb` after fetching the remote.
- Branch: `feat/sticker-custom-emoji`; worktree: `C:/PROJECTS/tg-assistant-sticker-media`.
- `npm ci --ignore-scripts` completed. `npm test`: 401 tests, 393 passed, 8 skipped, 0 failed on this Windows environment.
- No application behavior has been changed. No Telegram message, model turn, or deployment acceptance test was run.
- A public WebP sample opened successfully through this session's native `view_image`, using an extensionless local path. This does not establish compatibility of every deployed agent/runtime.

## Implementation verification

The narrowed implementation was verified on Windows with `npm test`: 407 tests, 399 passed, 8 skipped, 0 failed. The new tests first failed because the tool did not exist, then passed against the real controller, SQLite, BotFiles and download cache with only Telegram/fetch replaced by controlled test doubles. Wiki validation and whitespace checks passed. A separate read-only review found no actionable issues.

The exact dependency-installation shell block from `docs/operations.md` was executed in a disposable Alpine 3.22 x86-64 container. FFmpeg and lottie-converter v1.2.0 installed, and a minimal gzip TGS fixture was unpacked to JSON and rendered into `000.png`, `001.png`, `002.png`. ARM64 was not executed. Earlier, the user reported that the installed renderer let their agent inspect a real animation. These checks do not constitute live acceptance of the new custom emoji downloader: no real Telegram API or model turn was used for that method, and no deployed service or user context was changed.

## Current behavior and the missing pieces

1. [short-message.mjs](../../src/telegram/short-message.mjs) turns a sticker into `sticker: sticker.emoji ?? ''`. The associated Unicode emoji is a category/alternative, not a description of the actual artwork.
2. Text/caption formatting becomes only `hasEntities:true`. The short event does not distinguish custom emoji from bold or links. Rich text is likewise summarized without identifying its custom emoji.
3. [history.mjs](../../src/agents/history.mjs) preserves full native sticker metadata and entities through `read`, including the one-level embedded reply. This is already sufficient to discover sticker file IDs and thumbnail file IDs.
4. [download.mjs](../../src/files/download.mjs) accepts any accessible Telegram `file_id`, coalesces concurrent fetches and caches bytes under the caller's `.temp/<agentId>/download`. It returns an absolute, extensionless path. It can already download a sticker source or thumbnail, but does not render animations.
5. [threads.mjs](../../src/codex/threads.mjs) sends event batches as JSON text. There is no automatic image attachment to a turn, nor a controller tool for `getCustomEmojiStickers`.

## Telegram formats and retrieval

| Kind | Original | Static viewing | Motion viewing |
|---|---|---|---|
| Static sticker/emoji | WebP or PNG raster | Download original and open as an image | One image; no motion |
| Vector animated sticker/emoji | TGS: gzip-compressed Lottie JSON | Optional Telegram thumbnail, or render a selected frame | Decompress JSON, render selected frame numbers to PNG |
| Video sticker/emoji | WebM container, VP9 video | Optional Telegram thumbnail, or decode a selected frame | Decode selected frames to PNG with FFmpeg |

The Bot API sticker's `is_animated` and `is_video` identify the animation category. `thumbnail` is optional and, for an individual Sticker, is a WebP/JPG image. Do not confuse it with a StickerSet thumbnail, which may itself be animated. A thumbnail may be smaller than the source and does not represent all motion.

An incoming standalone sticker already contains a `Sticker` object. Custom emoji within text/captions instead supply `custom_emoji_id` in `entities` / `caption_entities`; rich custom emoji nodes also contain that ID. Resolve unique IDs with `getCustomEmojiStickers` (up to 200 per request), then use the returned Sticker's source or thumbnail `file_id` with `download`. Keep IDs as opaque strings. Match returned stickers by `custom_emoji_id`, not response position.

## Recommended delivery model

Keep downloads on demand within the agent turn, consistent with existing photo handling. An event advertises the visual content; the agent reads metadata and opens images before describing it. This avoids downloading passive group history or every emoji before a message has been admitted to the agent queue.

Static route:

```text
short event → read(messageId)
  sticker: source file_id if static; thumbnail.file_id if animated
  custom emoji: custom_emoji(ids) → same selection from returned Sticker
→ download(fileIds) → native image viewer(path) → answer
```

If a reply refers to an old sticker, inspect the current outer message's `reply_to_message` before declaring the original unavailable. Ordinary Unicode emoji require no download. Multiple custom emoji must retain their relationship to the original text: entity offsets are UTF-16 offsets, whereas short text truncation currently counts Unicode code points; use the full native text for positional interpretation.

For an animated item with no thumbnail, static-only support reports that no preview is available. It must not pass TGS/WebM to an image viewer as though it were a raster image, or infer appearance from the alternative Unicode emoji.

## Proposed interfaces

### Core static support

- Add `customEmoji:true` to the short event when native text/caption entities or rich text contain a custom emoji. Preserve `hasEntities` and the existing `sticker` field, including its empty-string case. File IDs and entity details remain in `read`.
- Add `custom_emoji({customEmojiIds:string[]}) -> {stickers:Sticker[]}`. Require 1–200 nonempty string entries; deduplicate before the Bot API request. Invalid input returns `invalid_argument`. Telegram failures return `custom_emoji_unavailable` with a sanitized English description. An empty/partial native result must be recognized as unavailable metadata for missing IDs, not misassociated by position.
- Keep the existing `download({fileIds})` contract/cache unchanged unless a deployment-format acceptance probe demonstrates a concrete incompatibility.
- Update tool descriptions and the agent instructions: inspect the artwork before interpreting its contents; animated previews establish appearance only. Do not inspect every emoji repeatedly when its appearance is irrelevant to the response.
- Initial exposure is to the model agent only; do not expand the widget API allowlist as part of this task.

### Optional motion support

Add a local-file reader, consistent with `pdf_read`, provisionally named:

```js
sticker_render({path, mode: 'static' | 'frames', frameCount: 6})
// Result example, not a currently available tool:
({format:'tgs', animated:true, durationMs:2400, sampled:true,
  images:[{path:'.temp/AGENT_ID/stickers/HASH/000.png', timestampMs:0},
          {path:'.temp/AGENT_ID/stickers/HASH/001.png', timestampMs:480}]})
```

`frameCount` applies only to `frames`; allow integers 2–12, default 6. `static` renders a frame near the middle of an animation, avoiding an assumption that frame zero is representative. Static originals return one image regardless of frame mode. Frame sequences cover the source timeline in ascending order; actual selected frame timestamps accompany every image. Mark sequences as sampled when source frames were omitted. Six samples can miss a brief action; the agent can request a denser sequence within the cap.

Return separate images first: each retains full sticker resolution, temporal order and a useful timestamp. A numbered contact sheet is a possible later convenience; it shrinks small emoji and does not replace frame metadata. Neither a GIF nor the raw TGS/WebM path is treated as proof that the model saw all frames.

The proposed backend choice is FFmpeg/ffprobe for WebM and `lottie-web` in the already-used system Chromium for TGS. Lottie offers explicit seeking; use a local bundled player, data passed as JSON, no autoplay and no external page. An alternative is rlottie, which exposes direct frame rendering but adds native build/binding or WASM packaging work. Before finalizing the motion implementation, compare both on a small licensed TGS fixture set on Windows and Alpine. This comparison is a dependency decision, not a reason to delay core static support.

Rendered outputs use the caller's BotFiles area and existing temporary-file retention. Cache keys include content hash, renderer version and render settings. Coalesce concurrent identical renders; failures leave no completed cache entry. Require permitted regular-file input, bounded input/decompression/output sizes and a 30-second operation deadline; close subprocess/browser resources on failure. Preserve transparency, check VP9 alpha decoding, and reject external assets/expressions in animation input. Treat `needs_repainting` emoji as adaptive artwork; document any chosen preview color instead of promising exact Telegram theme matching.

## Implementation tasks

### Task 1: Make custom emoji discoverable

**Files:** modify `src/telegram/short-message.mjs`, `test/integration/short-message.test.mjs`; create `src/telegram/custom-emoji.mjs` for detection helpers if the rich-text walk needs sharing.

- [ ] Add focused cases for text entities, caption entities, nested rich custom emoji, ordinary emoji, unrelated formatting, and a sticker whose emoji is missing. Example assertion after building the existing test fixture:

```js
assert.equal(shortMessage({message_id:1,date:1,text:'🙂',entities:[
  {type:'custom_emoji',offset:0,length:2,custom_emoji_id:'123'}
]}).customEmoji, true);
assert.equal(shortMessage({message_id:2,date:1,text:'🙂'}).customEmoji, undefined);
assert.equal(shortMessage({message_id:3,date:1,sticker:{file_id:'S'}}).sticker, '');
```

- [ ] Run `node --test test/integration/short-message.test.mjs`, observe the new assertion fail, then implement the additive flag and rerun.
- [ ] Verify the flag survives edits/history/search through the existing shared short-message projection; no duplicate derived data is stored in SQLite.

### Task 2: Resolve custom emoji to native Sticker metadata

**Files:** create `src/telegram/custom-emoji.mjs` (or extend the helper from Task 1) and `test/integration/custom-emoji.test.mjs`; modify `src/controller.mjs`, `src/codex/threads.mjs` and `test/integration/codex.test.mjs`.

- [ ] Write fake-Telegram tests asserting the exact `getCustomEmojiStickers` method and `custom_emoji_ids` payload, opaque string preservation, deduplication and 200-ID boundary. Cover invalid/null input, rejection, shuffled results and missing IDs.
- [ ] Implement `createCustomEmoji({telegram})` returning an async `(scope,args)` handler with the interface above; keep error output free of raw request URLs/tokens.
- [ ] Register the dynamic tool and dispatch under existing scope/lifecycle checks. Test a controller invocation through a fake agent, rather than only a direct helper call.
- [ ] Run `node --test test/integration/custom-emoji.test.mjs test/integration/codex.test.mjs`.

### Task 3: Teach and verify the complete static path

**Files:** modify `src/codex/threads.mjs`, `test/integration/profile-download.test.mjs`; create `test/integration/sticker-media.test.mjs` and `test/live/sticker-media.mjs`.

- [ ] Use valid small image fixtures and a fake agent/Telegram transport to exercise standalone static sticker, animated sticker thumbnail, custom emoji metadata → download, mixed/repeated emoji and the outer-reply case. Assert actual saved bytes, selected file IDs and existing concurrent-download/cache behavior.
- [ ] Cover missing thumbnails, failed downloads, unavailable IDs and an authorized message with no group trigger. No automatic download is expected merely because passive history was saved.
- [ ] Add clear agent guidance, including `customEmoji:true`, presence of `sticker` even when empty, UTF-16 positions, and the difference between previews and motion.
- [ ] The bounded live script should accept a controlled fixture set, use an isolated chat/thread, and cap attempts. Verify source/thumbnail WebP/JPG paths actually open in the deployed image viewer and that the agent's description depends on the artwork. Keep new-thread acceptance separate from an existing resumed thread: refreshed dynamic tools/instructions must not be assumed effective without checking. Do not reset a user's chat as an implicit rollout action.
- [ ] Run the relevant automated files. Run live acceptance only as a separately identified deployment check with a known fixture route; fake-agent success is not visual model acceptance.

### Task 4: Optional frame renderer, if selected

**Files:** create `src/readers/sticker.mjs`, focused TGS/WebM backend modules as needed, `test/integration/sticker-render.test.mjs`; modify `src/controller.mjs`, `src/codex/threads.mjs`, `package.json`, `package-lock.json`, and `test/live/sticker-media.mjs`.

- [ ] First choose the TGS backend using the compatibility comparison above and pin the selected dependency. Add FFmpeg/ffprobe to the documented deployment prerequisites; neither executable is currently found on this Windows PATH.
- [ ] Write fixture-driven tests for static vs frame mode, chronological timestamps, endpoint coverage, very short clips, nonzero Lottie in-points, alpha, missing decoder, invalid TGS/gzip, unsupported assets, timeout and cache recovery after failure.
- [ ] Implement the proposed `sticker_render` contract behind injectable subprocess/browser dependencies, retaining real-decoder tests for rendered image correctness. Sample known frame indices rather than relabeling an arbitrary decoded image with an approximate timestamp.
- [ ] Produce PNG files in the caller's temp area; return paths only. Open the sequence in temporal order during live acceptance. A successful render alone is not a successful model interpretation.
- [ ] Test Windows and Alpine packaging, process cleanup and a real transparent VP9 fixture before claiming deployment support.

### Task 5: Documentation and final verification

**Files:** update the affected maintained English wiki articles: `docs/message-events.md`, `docs/agent-contract.md`, `docs/agents.md`; update `docs/storage.md` and `docs/operations.md` if motion dependencies/cache behavior are included. Link this proposal from `docs/dev/index.md` without presenting it as implemented behavior.

- [ ] Document exact fields, tool results, failures, preview limitations, motion sampling and deployed prerequisites corresponding to the approved implementation scope.
- [ ] Run `npm test`, `node docs/dev/check-wiki.mjs` and `git diff --check`; report totals/skips and distinguish local checks from live acceptance.
- [ ] Report remaining motion/thumbnail/theme limitations and inspect the final branch diff. Leave commit/merge/push to explicit user authorization.

## Sources checked during investigation

- [Telegram sticker formats and requirements](https://core.telegram.org/stickers).
- [Bot API Sticker, including optional static thumbnail](https://core.telegram.org/bots/api#sticker).
- [getCustomEmojiStickers](https://core.telegram.org/bots/api#getcustomemojistickers) and [MessageEntity](https://core.telegram.org/bots/api#messageentity).
- [getFile](https://core.telegram.org/bots/api#getfile).
- [Telegram's TGS decompression and Lottie loading](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/AnimationUI/Sources/AnimationNode.swift).
- [Lottie-web explicit seeking and canvas rendering](https://github.com/airbnb/lottie-web).
- [rlottie direct frame rendering](https://github.com/Samsung/rlottie).
- [FFmpeg frame selection filters](https://ffmpeg.org/ffmpeg-filters.html).
