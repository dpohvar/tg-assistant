# Browser and PDF reading implementation plan

Goal: expose browser_read(url) and pdf_read(path, pages?, render?) to Telegram agents without MCP.
Architecture: controller-owned Chromium with isolated contexts, bounded public HTTP fetches and explicit challenge errors; Poppler reads sandbox-approved PDF bytes and optionally writes page PNGs to own temporary storage.
Spec: approved discussion of 2026-10-09; Wizz Air challenge must be reported, never bypassed.

## Constraints and review focus
- Keep Codex network-disabled sandbox unchanged; no database migration.
- Refuse private/local URLs, redirect targets, subresources, credentials and non-GET requests; pin DNS lookup for actual HTTP connections.
- Limit time, bytes, request count, PDF pages and text; clean OS workspaces and browser contexts on failure.
- Read files through BotFiles, preventing other agents temp, secrets and symlinks.
- Return English error descriptions; scraped content is data, never instructions.

## Tasks
- [x] Write regression tests for URL policy, isolation, CAPTCHA, truncation, PDF extraction/render and failures; observe RED.
- [x] Implement src/readers/network.mjs, browser.mjs and pdf.mjs; run focused tests.
- [x] Register tools in threads/controller, document Alpine dependencies and schemas; test dispatch.
- [x] Run full Windows and Alpine suites, real PDF and Wizz Air probes; independent review, commit, push feature branch and create PR to main.

Ruling: implementation already authorized; execute continuously without another planning approval. No login, arbitrary browser scripting or clicks are exposed.

Validation: Windows 173 passed, 7 platform/native skips; Alpine 180 passed, 0 skips (TG_READERS_NATIVE=1). Real private PDF verified without saving personal data in Git. Wizz Air returns browser_challenge. Independent review findings fixed and re-reviewed. Ruling: Chromium uses in-process GPU with renderer sandbox enabled to avoid musl GPU seccomp crash; no GPU or GUI required.

