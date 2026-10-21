# Guest widget callback routing implementation plan

> Execute inline with systematic debugging, TDD and verification-before-completion. Do not commit, push, merge or deploy without authorization.

**Goal:** Handle a guest widget callback when Telegram supplies a different inline address to another participant in a private conversation.

**Evidence:** The bounded native Guest Mode probe reproduced the failure. The publication/owner callback used a 20-byte ID, another participant's callback a 24-byte ID with different DC, identity and access fields. Treat both as opaque addresses; do not infer an ordinary chat or alias equivalence from them.

**Design:** Encode inline/guest widget buttons with a controller token derived from the random view ID and a digest of the complete authored callback. Resolve only against the same bot's current, active, confirmed inline view and exact current callback registry. Decode the authored string for dispatch. Preserve the observed callback inline address in native event data, but render only to the source view's stored address. Do not claim ownership of a previously unknown callback address. Reject a token on another already-bound view, ordinary-message routes, stopped/uncertain views, retired views and stale callbacks. Ordinary message callbacks and existing unencoded callbacks at their exact known address remain supported. Tokens fit 64 bytes even when the authored string consumes the full 64-byte limit. No schema migration or handler recompilation is required; an explicit update_widget repaints existing inline controls.

**Files:** `src/widgets/callbacks.mjs` implements encoding/resolution; `render.mjs` changes only the inline wire payload; `events.mjs` resolves source views and restores the local callback. Manual acceptance guards admit scoped token callbacks before controller routing. Regression tests exercise actual rendering, event admission and shared-state changes. Wiki documents source-view targeting, compatibility and repainting.

- [x] Reproduce differing-address failure with a focused integration test; cover foreign targets/bots, retirement, stale keyboards, rich/void/full-length payloads and source target preservation.
- [x] Implement scoped tokens, preserve native user/address and authored callback semantics, and update bounded acceptance admission. Run focused suites.
- [x] Run full suite, wiki and diff checks; review routing/authority changes. Repeat native Guest Mode Wordle with the other participant starting and typing first. Record actual evidence and unresolved limits.

**Verification checkpoint:** Full Windows suite: 746 tests, 738 passed, 8 skipped, 0 failed. Wiki checker: 20 articles, 565 local links, 18 JSON examples and 55 tools. Independent review approved the fix and all ten dedicated callback tests. Native Guest Mode acceptance of the repaired version passed: the other participant started Wordle and entered five letters from a different inline address; the owner's subsequent callback also reached the same widget. The user confirmed visible success. The original broken trace, raw-address comparison and successful fixed trace are retained only in private test runtime artifacts. Production installation remains outside this completed local fix and acceptance step.
