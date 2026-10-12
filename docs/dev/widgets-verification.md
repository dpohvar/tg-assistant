# Widget implementation verification

Implementation branch: `feature/telegram-widgets`, based on `e5dbe01`. This report distinguishes personal implementation checks from user acceptance. The current contract is [../widgets.md](../widgets.md); the agreed work is [widgets-plan.md](widgets-plan.md).

## Implemented scope

- Sandboxed immutable TS/TSX builds and one shared Node event loop per owner, with the agreed widget/process quotas, external memory monitoring, heartbeat and bounded cleanup.
- Transactional schema 13, registration/state/event persistence, generation fencing, retained disabled backlog, recovery receipts and bounded poll-answer observations.
- Native rendering, JSX rich/plain formatting, exact media cache mapping, Telegram-supported conversions without replacement sends, callbacks/replies/reactions/polls and managed resources.
- Six agent tools, approved `ctx.api` capabilities, administrator `/widget` commands, English help/wiki and eight runnable authoring examples.

## Automated regression

`npm test`: **380 tests, 372 passed, 8 skipped, zero failures**. The skipped checks require Linux or opt-in native browser/PDF environments; they are not represented as successful runs of this suite on Windows. Separate explicit platform and Telegram probes below cover the widget acceptance scenarios.

The regression suite covers limits and admission, malformed transport, snapshot/build restrictions, owner authority, FIFO ordering, state/render errors, stale callbacks, generation replacement, shutdown races, disabled debug rendering, poll/reaction projections, command roles, owner/chat deletion and history retention. Migration checks preserve pre-existing chat history, tasks, notes, vault, MCP configuration and usage data, verify reopen idempotence and rollback of failed upgrades.

`node docs/dev/check-wiki.mjs` checks the current wiki, local links, JSON examples and controller tool references. Run it again whenever documentation changes.

A separate fresh-context review inspected lifecycle, recovery, sandbox, routing and publication failures. Reported issues were repaired and regression-tested; the final review found no remaining Critical or Important findings. In particular, old generations cannot publish or commit after replacement, shutdown drains outstanding lifecycle operations, disabled resume restores buttons, and known publication IDs survive failure reporting.

## Actual sandbox processes

The explicit [runtime acceptance program](../../test/manual/widget-runtime-acceptance.mjs) passed on Windows (Node 26.8.2, strict MXC sandbox) and Alpine (Node 24.18.1, nonroot Codex sandbox). Both used Codex 0.159.3.

Each run built and exercised all eight examples, then checked filesystem/environment isolation, self-replacement and stale effects, controller restart, heartbeat during a 12-second asynchronous action, termination of a tracked detached child, a synchronous event-loop hang, a 350 MiB Buffer allocation and bounded cleanup after a hanging stop hook. Each produced 49 simulated Telegram calls and the three expected runtime-failure notifications. These are real sandbox/process tests with a simulated Telegram endpoint, not human callback acceptance.

A second Windows launcher installation, reporting the same Codex version, exceeded the agreed 256 MiB conservatively counted working-set threshold during the asynchronous case. The runtime stopped and notified its owner as designed; that launcher did not complete the full probe. The configured sandbox launcher completed it. Keep this deployment limitation visible: helper processes/shared pages count toward the threshold, so a different Windows executable/backend may require host investigation. The implementation does not silently raise the limit or remove helpers from accounting.

## Actual Telegram requests

The explicit [Telegram acceptance program](../../test/manual/widget-telegram-acceptance.mjs) used the designated test bot, an existing private test dialogue and a permitted passive test supergroup. It created its own fixtures, consumed no updates, exercised the production widget service/renderer and strict Alpine sandbox, and deleted its fixtures where Telegram allowed deletion.

- Repeated the previously documented singleton conversion matrix through widget rendering, preserving message IDs for every successful conversion. Telegram rejections remain explicit errors; there is no delete/resend fallback. Static location/venue to live location was again rejected.
- Native photo, video, animation, audio and document rendering reused the exact returned file IDs on subsequent renders without uploading again. Venue, contact, poll, dice, voice, sticker, square MP4 video note and live photo creation succeeded in their permitted targets.
- Photo/video/animation cache mapping succeeded in plain blocks, details, lists and slideshows. Audio/document/voice-note mapping succeeded in plain blocks, details and lists. Telegram rejected their slideshow forms with `RICH_MESSAGE_BLOCK_UNEXPECTED`, an expected native limitation.
- Nested mixed media, details/lists, maps, media reordering and changed local files passed: reordering uploaded nothing, and changing a file uploaded it again.
- Native HTML-style JSX aliases, an open details block, date/reference links, a captioned compact bordered table, spoiler figure/caption credit, math and maps were accepted by Telegram.
- Live location edits/stopping, video-cover caching, fresh thumbnails and cross-chat publication passed.

Private-dialogue voice restrictions initially prevented voice/video-note tests. Those types were then checked in the permitted test group without changing privacy settings. A rectangular MP4 submitted as a video note returned an ordinary `video`; exact mapping refused it. A generated square MP4 then produced `video_note` successfully. Fixture preparation used ffmpeg only in the disposable acceptance container; ffmpeg is not an application dependency.

Telegram refused immediate deletion of fresh dice in the private dialogue. Those fixtures are identifiable test dice and are not claimed as cleaned up; the native API restricts deleting them until more than 24 hours after sending. The test does not delete unrelated messages or schedule hidden cleanup.

## Remaining acceptance and limits

The first user trial exposed an authoring failure: the agent passed source code as `handler` three times instead of saving a file. The tool reached the compiler, which treated the code as a path and reported `Unresolved dependency`; there were no saved TS/TSX modules or created widgets. The tool/property descriptions and developer instructions now explicitly show file creation followed by `set_widget({handler:'widgets/counter.tsx',...})`, with a minimal send-shaped counter example. Inline source and missing-file diagnostics have regression coverage. A further live check used a private mode-0600 TSX file in the actual test bot workspace, built it in the strict sandbox, sent its counter to Telegram, dispatched an increment and verified the edited text before deleting the fixture. The application does not interpret inline code or silently create a handler file.

The user accepted the updated test bot and requested a direct merge and push to `main`. This acceptance does not establish that every client scenario was individually exercised: actual button presses/alerts, rapid repeat presses, replies, reactions, poll voting and behavior while the model is busy remain separate test dimensions. The controller routes and projections have automated coverage, but a simulated callback does not establish the Telegram client experience.

A second user trial found a disabled, rapidly updating game while its owner was waiting for model responses. Replaying the same handler in the actual Alpine sandbox against Telegram reproduced an explicit `Too Many Requests: retry after 41` on a redundant keyboard edit. The original widget retained only the generic failure code, so that reproduction does not establish the exact original native error. The owner's delivered session contained neither a detailed widget-error event nor the rate-limit text; queued notification loss after an agent timeout is the likely explanation. Codex warning logs separately showed disconnected response streams and retries; widget tool calls completed promptly.

The renderer now combines content and keyboard edits, waits only explicitly rejected edits with valid `retry_after`, and rechecks authority during waiting. Regression checks cover retry success, generation cancellation, no initial-send retry and immediate best-effort cleanup. Disabled rendering failures retain their description for later inspection even if an owner notification is lost. A further real sandbox/Telegram game run injected one deterministic 429 with a one-second delay; rendering resumed and the widget stayed active. That injected response validates the recovery path, not a new naturally occurring flood-limit incident. Saved game timers still require correct `onInit` restoration in the author's handler.

The designated Alpine test service has been restarted with this feature branch after a private SQLite backup. Readiness was confirmed, the existing registry retained its test bot, schema 13 and all four widget tables were present, and all six widget tools were registered. No test registrations were inserted into the stand by the acceptance probes, which used separate synthetic controller databases. Existing sessions receive updated tools/instructions on their next resume.

Not exhaustively tested: every media encoding/native field combination, business/inline/paid messages, raw rich HTML with separately declared media cache mapping, arbitrary native addons/dynamic package assets, or unsupported OS backends. Managed cached rich media should use JSX or explicit native blocks. No claim is made that OS sandboxing prevents a script from bypassing authoring policy inside its own allowed sandbox.

After live acceptance, the user's explicit direct-merge instruction superseded the earlier PR handoff. Integrate into `main` after fresh regression and wiki checks.
