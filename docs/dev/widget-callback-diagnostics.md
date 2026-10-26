# Widget callback diagnostics

The standalone [diagnostic script](../../test/legacy/manual/widget-callback-diagnostic.mjs) observes the local controller database with Node's read-only SQLite connection. It needs Node 24.18.1 or later and schema 15 or later, has no npm dependencies, imports no application startup code and makes no Telegram calls. Copying this one file to a server is sufficient; the controller can keep running. No migration or service restart is performed.

Find the working old and failing new widget IDs using `/widget list all` and `/widget show WIDGET_ID`. Then run as a user with access to the existing controller database:

```sh
node widget-callback-diagnostic.mjs \
  --db /path/to/controller.sqlite \
  --widget OLD_WIDGET_ID --widget NEW_WIDGET_ID \
  --watch-seconds 120
```

The first JSON line is the baseline. Further lines appear when the sampled metadata changes. Watch duration is bounded to 300 seconds; omitting it performs one read. Samples use separate short read transactions and do not hold a transaction during the 250 ms polling delay. Normal SQLite read coordination still applies. Use the actual live database, rather than an isolated copy, to observe new admissions.

Test the idle Wordle menu, not another player's active keyboard. Let a second participant press Start first. Compare a quiet baseline, that participant's press, and the owner's press at recorded times. Returning to the menu between successful starts keeps the input conditions comparable.

| Observation | Interpretation |
| --- | --- |
| `sequence` increases | An event was admitted for this widget, even if its queue drained before the next sample |
| `sequence` increases and `dropped` increases | Inspect dispatch invalidation, including stale views/buttons |
| `pending` or `running` remains positive | Work may be queued or blocked; inspect runtime health |
| `stateHash` changes | The committed JSON state changed; no game answer or raw state is printed |
| `state.mode` becomes `game` and `activePlayerHash` changes | Wordle committed a player selection |
| `lastErrorCode` appears on the widget or a view | Inspect that widget's runtime or publication error |
| `deliveryUnknown` is true, `buttonCount` is zero, or `hasMenuStart` is false | The saved publication/keyboard needs inspection before attributing failure to a user restriction |
| Different `snapshotId` values | Compare the actual saved compiled handlers; identical source filenames do not establish identical running code |

`sequence` counts **all** admitted events, including timers and agent events. It is not a callback counter or proof of which participant caused a change. Timer-driven state changes can also affect `stateHash`. An unchanged counter cannot distinguish a Telegram update that never arrived from a callback rejected before queue admission. That distinction requires logging at controller intake and widget routing in the running server process. Snapshots do not necessarily catch transient queued work or intermediate state.

The script prints widget/view IDs, handler paths, snapshot IDs, counters and error codes. Player identifiers and message addresses are hashed; game content, descriptions, raw callbacks, complete state and bot tokens are omitted. It does not load or execute saved handlers. A missing database is an error, never a request to create or upgrade one.

## Current investigation evidence

On base `fd34d09`, the native test bot accepted a nonowner's Wordle Start, letters and return to the menu through ordinary inline publication. A subsequent direct Guest Mode publication into a private conversation reproduced the server report: the owner's callback used the exact published 20-byte opaque inline ID, while the other participant's callback used a different 24-byte opaque ID, with different DC, identity and access fields. The raw IDs remain private runtime artifacts. This is not a safe basis for byte normalization or deriving ordinary addresses.

Exact-address lookup therefore missed the guest view before dispatch. The fix uses per-view opaque wire tokens for inline/guest widget buttons, restores authored callback data for handlers, and renders only to the registered view target. It does not claim the newly observed address or enlarge an agent's ordinary chat permissions. Focused tests exercise differing participant addresses, first guest publication, stale/retired/conflicting/uncertain views, bot isolation, rich buttons, void buttons and 64-byte authored callbacks. Legacy controls can be repainted with `update_widget({widgetId})`.

The bounded acceptance guards also recognize scoped widget tokens so they do not discard the very callback being tested. Ordinary inline acceptance remains confined to its designated participant and explicitly known messages otherwise. The guest runner writes exact callback addresses only to its private runtime directory for forensic comparison; these are not wiki content or public logs. A prior owner-only inline-runner filter was a separate test-harness limitation.

The repaired native Guest Mode test in a private conversation passed: the second participant's differing inline address was accepted, Start changed the shared state to `game`, and five letter callbacks committed input lengths one through five. A subsequent owner callback also reached that same widget from its original address. The user confirmed the result visually. The original Wordle sources were unchanged. Full Windows verification passed with 746 tests: 738 passed, eight skipped and zero failed; independent code review found no blocking or important issues. This verifies the local fix and designated native test bot, not installation on the user's production server.
