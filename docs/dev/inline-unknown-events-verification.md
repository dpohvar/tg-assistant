# Unknown-destination inline reply/reaction control

Status: completed for the requested fresh-group scenario. The user followed the nonmember-group probe and confirmed the button acknowledgement and private status summary. This is a Bot API capability observation, not a new widget route or Guest Mode implementation.

## Method

The bounded [passive runner](../../test/manual/inline-events-probe.mjs) uses the designated child token, verifies its identity/webhook, acquires the shared poller lock and runs for at most30 minutes. It has no model, controller admission filter or database writes. It returns one immediate text article with a unique marker and an opaque owner-only Confirm placement callback. It never sends, edits or deletes ordinary messages in a group. The owner can request a private summary with `/events status` and stop with `/events stop`.

The owner posts the card in the fresh group, presses its button, replies to the card, adds a reaction, waits30 seconds and requests the private summary. The callback is a positive observation for delivery from that inline publication, not evidence of a known group address. A private summary after the actions checks that polling is still operating.

The runner explicitly subscribes to `message`, `edited_message`, `message_reaction`, `message_reaction_count`, `my_chat_member`, `inline_query` and `callback_query`. Raw update-type counts and owner-origin group-message/reply counts are recorded before matching fixture content, preventing application filtering from masquerading as absent Telegram delivery. Exact fixture replies are counted separately. Unattributed reaction updates remain candidates; the probe does not invent a mapping from an unknown ordinary message ID to an inline ID. Membership changes are recorded so accidentally adding the bot is visible.

Only aggregate metadata, opaque IDs and fixture matches are logged; unrelated message content and query text are omitted. Callback acknowledgements target only this run's exact token from the designated owner. Status replies go only to that owner's private chat. No bot profile, rights, privacy setting or group membership is changed by the runner.

## Interpretation boundaries

The official [Update contract](https://core.telegram.org/bots/api#update) requires administrator status and explicit reaction subscription for reaction updates; anonymous reaction-count updates may be delayed for several minutes. The [FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get) distinguishes private messages and privacy-mode group delivery, including messages sent via a bot and replies to bot-directed messages. Membership and delivery permissions must be kept separate from an inline callback's availability. The [callback contract](https://core.telegram.org/bots/api#callbackquery) can identify an inline message without exposing its destination chat ID.

Zero observed replies/reactions in a bounded nonmember-group sample is recorded as such, not as proof for every bot mode, role or Telegram client. This run does not enable Guest Mode. A later membership/admin control, if performed, is a separate phase and cannot retrospectively change the original sample's membership conditions.

## Automated preparation

Four focused checks pass: matching replies from an unknown group survive observation; foreign callbacks/unrelated content are excluded; unmatched reactions stay candidates and membership changes are recorded; explicit configuration is required before network activity. Real Telegram accepted preparation of the marker card before polling. The user completed the client actions and the resulting counts are recorded below.

## Observed result

The inline callback arrived with an inline message ID and no ordinary Message. The user saw the callback acknowledgement. At the private status checkpoint, the passive runner reported:

| Observation | Count |
| --- | --- |
| Placement callbacks |1|
| Fixture replies, private / group |0 /0|
| Reaction candidates, private / group / anonymous |0 /0 /0|
| Raw owner-origin group messages / replies |0 /0|
| Bot membership changes |0|
| Completed poll cycles |10|

Transport types at that checkpoint were two inline queries, one callback query and one private message containing the status command. No group Message or reaction update had reached the probe, so no application filter was responsible for those zero counts. The status command arrived70935ms after the placement callback and128127ms after startup. Polling remained active and explicit reaction subscriptions were present.

For this observed unknown-destination scenario, button callbacks work; ordinary publication/replies/reactions were not delivered. The implementation therefore continues to use inline callback events for interaction and does not promise onReply/onReaction delivery for an unknown inline destination. This is a bounded observation under the stated conditions; no membership/admin or Guest Mode positive control was performed. The runner was stopped after recording the result.

At graceful shutdown, the counts were unchanged after17 completed poll cycles. The final observation was176545ms after the placement callback and233737ms after startup. The poller exited successfully and released its shared lock.
