# Sticker-set live verification

Verified implementation: `2fb4bfb`, with actual Telegram requests on the previously designated test bot and private test dialogue. This extends the offline verification in the [implementation plan](sticker-sets-plan.md). No production code changes were needed.

The opt-in [acceptance program](../../test/manual/sticker-telegram-acceptance.mjs) runs the production controller, Telegram adapter, SQLite registry, BotFiles and actual sandboxed TSX widgets. It reads the designated bot registration/token from an existing private configuration, creates an isolated temporary controller database, verifies the Telegram bot identity, and never polls or consumes updates. It does not start, stop, or upgrade the existing test service.

```sh
node test/manual/sticker-telegram-acceptance.mjs /private/test-config.json /private/results.json
```

The run used Alpine with Node.js 24.18.1, the existing Codex sandbox executable and FFmpeg for fixture preparation. The script generates its own deterministic PNG, WebP, gzip Lottie/TGS and VP9 WebM files. Its report contains sanitized check results, never tokens. Run only against the explicitly designated test bot/dialogue; it deliberately refuses another registration.

## Confirmed against Telegram

Nineteen functional checks passed:

- Regular PNG sticker set creation with the default application owner, and custom emoji PNG set creation with an explicit owner.
- Both set types: adding members, moving them, changing associated emoji, setting and clearing keywords, changing titles, and replacing a member. Subsequent live reads confirmed returned membership/order/title/emoji where those fields are exposed by Telegram; keyword changes were confirmed by the native success response.
- Regular PNG thumbnail upload/reset and custom emoji thumbnail selection/reset.
- Downloading a set member's original bytes and sending its discovered file ID directly, without source proof.
- Resolving a custom emoji ID to native Sticker metadata and downloaded bytes.
- Sending custom emoji entities in ordinary text and custom emoji RichText in a rich button. Telegram's returned messages retained the custom IDs. Editing the grouped button to its selected/disabled form retained the emoji and selection marker.
- Creating a real sandboxed sticker widget using a file ID absent from saved message history.
- Creating a real sandboxed TSX widget containing a custom emoji rich button, dispatching its action through `widget_event`, verifying changed state and a native Telegram edit retaining the custom emoji.
- Static WebP set creation; TGS and WebM VP9 creation for both regular and custom emoji sets. Downloaded TGS decompressed into Lottie JSON and downloaded WebM had the expected container signature.
- Removing a member from each of the two edited sets and verifying the reduced membership.
- Closing/reopening the controller and SQLite database retained the identical bot-wide catalog without uncertain entries.

Seven additional cleanup checks passed: every set created by the run was deleted through `sticker_set_delete`; a subsequent Telegram read rejected the deleted name, and the local catalog entry was absent. Created widgets and test messages were also deleted. No unrelated messages or sets were modified.

Final live result: **26 checks passed, zero failures** (19 functional, 7 set-deletion checks). The controller's regular automated suite before this run had 423 tests: 415 passed, 8 skipped, zero failures. The manual acceptance program is separate from `npm test` because it requires explicit credentials and performs external mutations.

## Limits of this evidence

No model inference was used. Tools were called directly through the production controller, and widget code ran in the real sandbox. The grouped-button edit used the production `closeButtons` transformation; the widget action used `widget_event`. This is not a real user callback from a Telegram client and does not establish visual appearance, click alerts or delivery timing on a particular client. The existing callback regression tests remain the evidence for controller event routing. Existing user-created sets were not edited; the test read its own sets through both short names and returned Telegram links.

Transport-loss/error-injection behavior and the intentionally reserved uncertain-name policy remain covered by offline tests, not induced against Telegram during this run. Actual permissions were sufficient for this test bot to send custom emoji in its designated private dialogue; this does not grant that capability to every bot or destination.

## Follow-up: native agent registration regression

The Telegram checks above called controller tools directly and missed their registration with Codex. A subsequent deployment exposed a real defect: the five sticker-set tool definitions lacked `type:"function"`, while the existing tools used that canonical envelope. Both Codex 0.159.3 and 0.161.0 rejected the mixed list with `Invalid request: dynamic tools must use either canonical or legacy format consistently`. This occurs before inference and also affects an agent whose context has just been cleared.

The sticker tools now use the same canonical envelope. The [credential-free native probe](../../test/manual/codex-tool-registration.mjs) reproduced rejection before the fix and accepted all 52 production tools afterwards on both versions. A new thread has no saved rollout before its first turn, so a credential-free thread-start probe alone does not prove resume or inference. Two adapter regressions exercise both start and resume with the complete tool list against a fixture enforcing the native mixed-format rejection.

The full automated suite after the fix has 426 tests: **418 passed, 8 skipped, zero failures**. The [full native agent probe](../../test/manual/codex-agent-telegram-acceptance.mjs) also passed on Codex 0.161.0: a fresh thread completed a real model turn and dynamic `send` with a matching Telegram receipt; after disconnecting, the saved thread resumed and completed a second real turn/send. It used isolated controller state and the designated test bot. Its two test messages and owned Codex session were deleted. This verifies the affected startup/resume path on 0.161.0, not comprehensive validation of that entire Codex release.

The final probe enforces its external-effect boundary in code: only one plain-text marker `send` per phase, only to the designated test dialogue, with notifications disabled. Other controller tools and extra sends are rejected before invocation; even an uncertain send consumes that phase's budget. A regression covers these restrictions. Session cleanup retains the isolated database's saved thread ID so a failed resume does not strand the preceding owned rollout.
