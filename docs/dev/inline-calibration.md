# Inline calibration procedure

Use the designated inline-enabled test bot and its private config. The runner has a synthetic agent and separate in-memory request state. It does not run the application controller or a native model. Do not run another poller for the same bot.

```sh
node test/manual/inline-calibration.mjs --config PRIVATE_JSON --case prompt --rows 8 --trigger-ms 2000 --wait-ms 5000 --duration-seconds 600
```

Only configured test users can create requests. Ordinary messages are ignored except owner commands in the owner's private chat:

- `/probe rows 1` changes the number of initial prompt rows; test 1, 2, 4, 8, 12, 20, 32, 50 around the first stable boundary.
- `/probe trigger 750` changes the trigger pause in milliseconds.
- `/probe wait 3000` changes the waiting-page deadline in milliseconds.
- `/probe ready 800` changes synthetic result latency in milliseconds.
- `/probe sample desktop_small` marks subsequent measurements with a device/window label.
- `/probe case mixed` uploads a generated colour PNG and JSON document into the owner's private buffer, then mixes text, rich, photo and document results. These are test fixtures, not user photos. The full media-family matrix remains a later production acceptance check.
- `/probe case waiting` selects the ordinary synthetic final result again.
- `/probe stop` ends the bounded run.

Policy changes close the current probe request; start a new inline query. In the source chat, enter `@BOT query`, first observe automatic loading without scrolling, then scroll deliberately and record that action. Selection publishes the configured result, including the neutral cross for service rows. The observer records timing and type metadata, never query text, credentials or full response contents.

Check mixed types on one page and the transition from already displayed article service rows to a media final page. Select every result and verify the posted message, not only the API response. Test alternate ordering and available Telegram clients. Full results and calibration decisions belong in [the results report](inline-calibration-results.md).

Generated private buffer fixtures are cleaned up when the runner exits. User-selected inline publications may need manual removal: an inline ID alone cannot be used with deleteMessage. This probe cleanup does not change the application's accepted no-auto-delete buffer policy.

## Automatic-prefetch page-size measurement

Run `--case prefetch --rows 1` to measure automatic loading independently of the submission threshold. Use `--rows 5` for the five-row control; `/probe rows 5` changes the experimental page size during a run and closes the previous sample. This transport returns exactly the configured number of articles and a next-page cursor immediately, including after pauses longer than two seconds. It never invokes an agent, starts waiting or returns a final application result. Rows match the production title-only prompt shape, with added continuous ordinals; selecting one sends the neutral cross. Production configuration is unchanged.

For the variable-size control, use `--case prefetch --page-sizes 6,6,10,20,30`. Each new initial query starts with 6, then 6, 10, 20, and 30 rows; subsequent pages repeat 30. Cumulative row totals are 6, 12, 22, 42, 72, 102, and so on. The summary sums the actual distinct pages, and logs include each page's size. `/probe sample desktop_scale_a` and `android_scale_a` label separate untouched 30-second trials. Do not issue `/probe rows` during this control: that command deliberately switches back to a fixed page size. The scale measures client pagination independently of the agent/timing heuristic; user predictions are not recorded as results.

Measure Desktop and Android separately. Before each trial, send `/probe sample desktop_rows1_a` (or `android_rows1_a`) privately, then paste a fresh complete inline invocation in the test chat. Keep the results open for 30 seconds without typing, scrolling or selecting. Afterwards send `/probe summary` privately and report completion. Repeat each client with a new sample label/query to distinguish a stable boundary from one transient sample. Record client version and viewport/orientation when available.

The summary counts distinct successfully answered blocks (pages) and rows separately, plus pagination requests, answer failures and time since the last request. Five confirmed blocks at five rows per page mean 25 rows. Duplicate cursors keep the same result IDs and do not inflate either count. New initial queries replace the previous sample; use the final settled query's sample ID. No query text is logged. The experiment caps each sample at 500 blocks and the whole run at 30 minutes; reaching a cap or seeing an API error invalidates a natural-plateau conclusion. A quiet sample with an available next cursor supports an observed prefetch boundary, not a universal minimum. Verify candidate initial page sizes directly: page batching may itself affect the client's loading decisions.

For the Desktop wheel-input control, label a fresh sample `desktop_rows1_wheel`, paste a new complete invocation, wait 10 seconds without interaction, then turn the wheel down over the result panel for about 5 seconds. Wait another 5 seconds and request `/probe summary`. Record whether a scrollbar appears and whether blocks beyond the initial burst are requested. Keep this separate from the untouched baseline: wheel input does not prove that the client actually moved its scroll position.

For the five-row immediate-scroll control, keep `--case prefetch --rows 5` unchanged, label a new sample `desktop_rows5_scroll`, and paste a fresh complete invocation. Start turning the wheel down over the panel as soon as results appear, continue for about 15 seconds, wait another 5 seconds, then request `/probe summary`. Compare with the untouched five-block / 25-row baseline and record whether later numbered rows and a working scrollbar appeared. This mixed automatic/manual run is a scroll-continuation check, not a new untouched-prefetch measurement.
