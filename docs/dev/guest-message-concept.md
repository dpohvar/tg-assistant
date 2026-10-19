# Guest Mode version 1: explicit invocation and widget publication

Status: current scope accepted and implemented in the guest-mode-v1 feature worktree on 2026-10-19. Planned automated and representative live acceptance completed; detailed results and limits are in the verification report. No production deployment is implied. Guest Mode answers an explicit invocation, including one inside a reply, with the caller's own personal agent. No hidden URL markers or automatic reply-owner routing are included. Widget publication and button callbacks remain supported requirements. Earlier reply-routing work is preserved separately in [deferred investigation](guest-message-reply-routing-future.md); historical probe evidence is in [verification](guest-message-verification.md).

The [implementation plan](plans/2026-10-19-guest-mode-v1.md) maps the accepted behavior to storage, compact events/read, guest sends, widget publication, agent schemas and automated/live checks. Its concrete helper interfaces and pending render target describe the implemented feature; integration into the main branch and production deployment remain separate actions.

## Invocation and membership

- A new eligible guest invocation selects the caller's current enabled personal agent. Without one, leave it unanswered.
- Every explicit mention is a new invocation of the sender's own personal agent, even if the message has `reply_to_message`, `external_reply`, `quote` or story-reply context. Never select the earlier response's owner or the widget owner merely from that context. A reply without an explicit mention is ignored by the guest route and does not enqueue an agent or widget `onReply` event.
- Check that the invocation actually names this bot through supported mention entities; do not trigger from arbitrary substring matches or from a username inside quoted content.
- If the receiving bot is already a group member, keep ordinary controller behavior. The enabled group agent handles eligible requests; an absent, disabled or stopping group agent does not fall back to a personal agent.
- Do not add a personal-agent branch to ordinary `message` handling. Known membership must also prevent bypass through a guest update. Guest and ordinary chat namespaces must not be merged from matching numeric IDs alone.
- Existing management commands and ordinary widget handling retain their behavior. These restrictions concern the new guest route, not removal of established ordinary reply handling.

The invoking user and agent owner are distinct from other people who later press public buttons. Existing permits and actor identity must be enforced on callbacks; the destination group does not acquire the personal owner's private permissions or become that agent's ordinary dialogue.

An invoked personal agent need not understand the group conversation. It may use its instructed one response for a clarification, for example `Уточни, что хочешь узнать про завтра?` after the caller writes `@bot, а завтра?`. The next guest request again requires an explicit mention. Telegram-provided reply/quote context may be projected as available input, but it grants no full-history access and never changes agent selection. Do not guess missing context or require successful thread reconstruction before admitting an otherwise valid invocation.

## Guest answer and exact ownership

The guest handler publishes its response with [answerGuestQuery](https://core.telegram.org/bots/api#answerguestquery). On confirmed success, [SentGuestMessage](https://core.telegram.org/bots/api#sentguestmessage) provides `inline_message_id`. This was observed live in the capability probe, including a matching button callback and an edit through the returned inline ID.

- Save the exact `(botId, inlineMessageId) -> agentId` relationship in the existing `inline_message_owners` store. Do not encode or infer ownership in message text, URLs, entities, captions, media, dates or ordinary guest message IDs.
- Register ownership immediately after confirmed publication, before committing the widget view or allowing later edits of this address. It must not require a button press to establish ownership. A new guest-publication operation is authorized by its scoped pending request before its native inline ID exists.
- Preserve the original selected agent for that publication and enforce existing owner/conflict checks on later edits and widget attachment.
- Expose the confirmed inline address to the publishing agent through the publication tool result. The accepted guest-send extension of `set_widget_view` returns its normal view ID/target result. For a plain guest answer, extend existing `send` with guest addressing instead of introducing the earlier proposed `answer_guest` method. The guest event schema still needs implementation design. This does not overload inline pagination or `set_inline_results` semantics.
- Reuse existing content normalization, supported native inline-result types and prepared-action button definitions where applicable. Guest answering publishes one result, with no drum or result selection by the user.
- Save a local content snapshot using the existing inline snapshot mechanism where it can be represented correctly. A local snapshot is not a Telegram message-read API or permission to read the destination chat.

Telegram publication and the local ownership/snapshot write are not atomic. The implementation must distinguish confirmed publication with failed local registration from a definite send rejection and an uncertain outcome. Do not blindly republish on uncertainty or report successful widget attachment before ownership is recorded. A retry/recovery policy and the guest-query answer deadline remain open implementation details.

## Ordinary guest responses through send

At the user's request, reuse the existing `send` interface and its message-content fields. Add `guestRequestId` as an exclusive alternative destination:

```javascript
send({
  guestRequestId: "<requestId from the guest event>",
  text: "Уточни, что хочешь узнать про завтра?"
})
```

The framework translates supported content into one `InlineQueryResult` and calls `answerGuestQuery` internally. The agent does not provide an inline-result title/ID or an `article` wrapper for ordinary text; controller-only envelope metadata is synthesized. Normal `send` without `guestRequestId` retains its existing behavior.

- Keep exactly one content field as in current `send`. Plan support for `text`, `rich_message`, `photo`, `document`, `video`, `animation`, `audio`, `voice`, `sticker`, `location`, `venue` and `contact`, where the supplied data/options can be represented by a native guest result.
- Reuse native content, caption/entities and supported formatting fields rather than introducing a separate guest message-body language. For action buttons, use the existing inline definition/permits machinery and persisted opaque button IDs; native chat-address callback routing cannot be assumed for the unknown destination.
- `poll`, `dice`, `video_note` and `media` as a `sendMediaGroup` album have no matching single native result. Reject them before publication. Games and invoices remain excluded. Inline keyboards are supported; ordinary reply keyboards have no guest-result equivalent.
- File/media support is subject to Telegram's per-result requirements, not a promise that every ordinary-send field combination maps unchanged. Sticker results require an existing sticker file ID. Other reusable media file IDs must have the established access/source proof; supported public URLs may be used where the native result allows them.
- Guest sending cannot upload local attachments. Reject `uploads`/`attach://` guest payloads. For generated files, the agent uses an authorized buffer chat (by default its private user, quietly), then supplies the resulting accessible Telegram file ID and source proof.
- `guestRequestId` cannot be combined with `chatId`, `topicId`, ordinary `reply_parameters` or ordinary-send-only options. Never reinterpret an invalid guest request as a normal send to the personal dialogue. Reject unsupported options rather than silently dropping them or changing delivery semantics.
- Return `{inlineMessageId}` after confirmed publication and local ownership registration. Ordinary sends keep `{messageIds}`; do not invent ordinary IDs for a guest publication.
- `send({guestRequestId,...})` and `set_widget_view({send:{guestRequestId}})` address the same Telegram guest query. Instruct the agent to publish at most one answer, but do not enforce a local publication-count limit. Forward authorized explicit calls and accept Telegram's actual outcome, including multiple successful answers. Local authorization, ordinary widget rendering locks and per-message ownership registration remain required.

The guest-send schema and conversion/error coverage are implemented in the feature worktree and remain subject to the final automated/live gate. The earlier standalone `answer_guest({guestRequestId,result})` proposal is superseded; no additional answer tool is planned.

## Independent invocations

Accepted: every sent guest invocation is an independent request, including several invocations from the same user in one or multiple chats.

- Give each invocation its own `guestRequestId`, mapped to its original Telegram guest query.
- Admit them through the existing queue of the selected personal agent. Preserve each request identity and destination even if the ordinary queue batches several events into one model turn.
- A newer invocation does not replace/cancel an earlier queued request or invalidate its prepared response. Do not apply inline typing/request replacement semantics to already-sent guest messages.
- Each `send` or guest `set_widget_view` answers only its explicitly addressed request. Two calls from one person in different groups must never exchange destinations or query identities.
- Track each request independently. Ending a model turn without a publication is an ordinary outcome and does not imply a failed request or a mandatory answer. Delayed background publication remains subject to Telegram accepting that query; local records are retained for 30 days without promising the same server answer window.

## Compact events and retained guest data

Accepted: enqueue a compact guest event, following the existing short-message conventions. Include its guest event type, `guestRequestId`, date, a bounded text/caption/rich-text preview, relevant attachment/formatting indicators, and available caller/chat summary. Clearly identify the public guest destination; do not project it as an ordinary private message or make its numeric IDs usable through ordinary chat-address APIs. Reuse existing field names and truncation rules where applicable. Final field-level schema is implementation work.

Persist the complete received guest message, including available native reply/quote context, before admitting the event to the agent queue. Extend `read({guestRequestId})` to return that saved message for the owning bot/agent only. Reading it does not fetch Telegram history or grant destination-chat access. The compact event may be sufficient to decide to answer or remain silent; a full read is optional.

Accepted: apply the common 30-day local retention policy to new guest request records, full incoming messages and publication results, measured from receipt. Use the existing retention mechanism rather than a separate short-lived in-memory request service. Retained request identities remain available after controller restart; the agent must not be automatically rerun merely because an unanswered record survives. Cleanup is silent. This does not expire live widget state/views or remove ownership still needed by a live view; retain the existing widget/inline ownership lifecycle exceptions. Local retention is independent of Telegram's undocumented answer deadline.

Observed on 2026-10-19: Telegram did not reliably enforce one answer. In run `44e5d8`, the first sequential answer succeeded and both later repeats returned the same generic HTTP 400 query-invalid/expired error. Two simultaneous first answers to a different fresh query both returned success with different native inline IDs, and the user showed both published messages. These were direct Bot API calls using the same respective `guest_query_id`, not a production `guestRequestId` adapter, which had not yet been implemented at the time. Both updates had native chat type `private`; group-specific repetition has not been tested by this run. See [verification](guest-message-verification.md#repeat-answer-probe).

Accepted after the live result: one answer is an agent instruction, not a controller-enforced invariant. The user explicitly accepts accidental multiple publications if Telegram allows them and rejected the proposed local atomic admission/duplicate-publication guard. Do not add a request reservation, consumed flag, publication-count constraint or busy/already-answered precheck that prevents a further authorized explicit call to Telegram. A prior success does not make the retained request unreadable or locally unusable. This does not change the accepted 30-day retention, authorization or optional-answer behavior.

Retain every confirmed publication result separately, especially each returned inline ID, because ownership, message snapshots and widget bindings already need them. A request can have multiple successful publications; never overwrite the earlier message/view binding with the latest result. Each successful guest widget send binds its own new view normally. Return success for every confirmed successful call rather than replacing it with a synthetic duplicate error. When Telegram rejects a call, preserve its original error details; a known earlier confirmed answer can make the explanation clearer, but the generic HTTP 400 alone cannot establish an already-answered cause. An uncertain publication must not be treated as confirmed success or automatically retried. This is outcome accounting, not local duplicate-publication prevention.

## Publishing a widget in response to an invocation

Required example:

```text
User: Проверка @bot, опубликуй Wordle
Bot: the interactive Wordle widget, already rendered in the first message
```

The user accepted automatic publication without an intermediate text response and the following API extension of the existing `send` envelope, without a new `kind` discriminator:

```javascript
set_widget_view({
  widgetId: "<widgetId>",
  send: { guestRequestId: "<requestId from the guest event>" },
  props: {}
})
```

The widget instance is still created through `create_widget` or selected from existing owned widgets. `set_widget_view` publishes one new view of that instance; it does not implicitly create a new widget controller.

The framework performs the full publication sequence inside this one tool operation:

1. Resolve the controller-generated `guestRequestId` and check the bot/selected agent/caller and local record availability. This is an opaque scoped handle, not an arbitrary group address or raw agent-supplied Telegram query ID. Plain guest answers and widget sends address this same Telegram query, without a local single-publication reservation or consumed check.
2. Allocate the candidate view ID and run the widget's first render with the supplied props under its normal widget queue/locks. No Telegram inline message address exists yet; the candidate render context must represent an unpublished destination without inventing a real chat/message ID. The implemented pending target is the frozen `{guestRequestId}` object; confirmation replaces it with `{inlineMessageId}`.
3. Prepare the complete render, including buttons, and validate that it can be encoded as the single native inline result accepted by `answerGuestQuery`. Publish this prepared render as the guest answer itself. The first visible message is the widget; there is no mandatory placeholder send followed by an edit.
4. On confirmed publication, record native inline ownership, the rendered snapshot and the view binding using the returned inline message ID. Return the existing result shape `{viewId, target: {inlineMessageId}}`. Later renders edit that exact address normally.

`send: {guestRequestId}` and ordinary `send: {chatId, ...}` are exclusive alternatives. Do not mix guest addressing with `target`, ordinary chat/topic IDs or ordinary send-only options. Telegram decides whether an explicit answer call is still accepted; a prior success does not block it locally. Keep confirmed receipts and preserve uncertainty rather than blindly retrying automatically. Validate agent/request authorization and local record availability again immediately before the external effect.

First-render errors must leave no visible intermediate message. Unsupported initial render formats fail before publication. In particular, the guest-result transport does not upload local files; supported media need existing file IDs or public URLs prepared through the established buffer flow. A poll-style initial render has no matching native inline-result type and cannot silently switch to an ordinary group send or placeholder. Text/rich widgets with inline buttons fit the intended route; unchanged Wordle is the required live control.

Publication and local commit remain separate effects. Preserve confirmed/uncertain publication receipts and report binding-persistence failures without automatically issuing another guest answer. Handle callbacks that arrive while the publication/binding operation is completing without handing the message to another agent or treating an incomplete registration as successful. This needs explicit implementation/regression coverage, not assumptions about human click timing.

This is an accepted design extension of the current manager/render API. The feature worktree accepts `guestRequestId`; automated checks and the unchanged Wordle live control verified direct guest publication, buttons and retained binding after controller restart. See the verification report for the exact conditions.

The previously agreed activation-card variant also remains available when the agent chooses it: publish `Wordle` with a prepared `[Начать]` action button, register the button and permits using the existing inline mechanism, then let its accepted callback reach the owning agent. That agent calls `set_widget_view` on the callback's exact inline address. Button callbacks are supported UI actions, not guest reply routing. One-shot groups, duplicate admission and permits keep their existing semantics.

Once a widget view exists, its callbacks resolve by exact `inline_message_id` through the view registry and go to the widget handler, not to a model merely because a game button was pressed. Existing owner/conflict checks prevent another agent from taking over the message. Inline-view state, limits, lifecycle, timers and persistence are unchanged by this design.

## Explicitly excluded from version 1

- No controller-generated hidden links, invisible anchors or routing metadata in text/rich content/captions. Ordinary links supplied as actual content remain ordinary content.
- No owner-user or view-ID URL markers, marker stripping/regeneration, or marker decoration of widget renders.
- No implicit guest reply chaining, reply-owner inference, reply fingerprints, guest-to-ordinary address inference, or guest widget `onReply` dispatch. An explicit mention while replying to a widget is still a fresh invocation of the caller's personal agent, not a widget event or a route to its owner.
- No ordinary-message personal fallback when the bot is a group member.
- No new permission to send arbitrary messages to the unknown guest chat, access its history, or deliver reactions merely because one guest response was published.

The earlier owner-marker and view-marker plans are archived, not pending prerequisites for this release. Do not implement their migrations or test requirements as part of version 1.

## Optional answers and remaining timing work

Accepted: an agent may leave a guest invocation unanswered. This is normal behavior, including ending a turn without `send` or guest `set_widget_view`. Do not synthesize a public placeholder/failure message, a private unanswered-request warning, a reminder to the agent, or an automatic rerun merely because no answer was published. A background continuation can still attempt publication while its request is valid; model-turn completion alone must not be used as an error signal.

An explicit publication operation is different from absence of an answer: `send`/`set_widget_view` must return real validation, Telegram or persistence failures to their caller, retaining the existing confirmed/uncertain distinction without blind automatic retries. Do not silently swallow such a tool failure, and do not automatically publish an extra user-facing error message for it.

Timing research on 2026-10-19 found no numerical answer deadline in the official [answerGuestQuery description](https://core.telegram.org/bots/api#answerguestquery) or [Guest Mode overview](https://core.telegram.org/api/bots/guest-mode). In the inspected public sources, `telegram-bot-api/Client.cpp::process_answer_guest_query_query` and TDLib `InlineQueriesManager::answer_guest_query`/`SetBotGuestChatResultQuery` forward the request without an explicit query-age check on that code path. TDLib's method/update schema comments likewise expose no expiry field. This establishes only the absence of a published/local limit in those places, not an unlimited lifetime on Telegram's remote servers.

The usable maximum delay has not been calibrated live. Do not import limits from inline queries, callback acknowledgements, pre-checkout/join-request queries or HTTP long-polling timeouts. The accepted 30-day local retention is a storage policy, not Telegram's server acceptance window. Measure delayed guest answers if a specific supported waiting interval is needed. Expiry/cleanup of an unanswered request remains silent. No guaranteed late-answer window is accepted yet.

Technical follow-up for the implementation plan: finalize compact guest event/read schemas; define the unpublished render context and native-result conversion; preserve existing ownership, permits, queue and widget limits; retain confirmed/uncertain results for each publication and normalize actual Telegram errors. The agent instruction should request at most one answer, while the controller imposes no separate duplicate-publication limit.

## Required implementation checks

- A new explicit guest invocation reaches only the caller's available personal agent; missing or disabled personal agent stays silent.
- A completed model turn without a guest answer is not an error and creates no placeholder, private warning, reminder or rerun. Later background work can publish only if its own request remains available. Explicit send failures still return their actual structured error to the agent; expiry of an unanswered request stays silent.
- Compact events follow short-message conventions and permit a decision without full read. Full `read({guestRequestId})` is scoped to the owning bot/agent, preserves native available context and never fetches group history. Test truncation, attachments, forbidden cross-agent reads, 30-day cleanup, restart persistence and retention of live widget bindings/ownership.
- Multiple invocations by one person keep separate handles, destinations, prepared content and Telegram query identities through queue admission and model-event batching. New invocations do not cancel earlier ones. Test simultaneous invocations in two different guest chats and independent expiry/publication.
- Replies without an explicit mention never enqueue an agent request or guest widget `onReply`. An explicit mention inside a native/external/quoted reply selects only the sender's personal agent, even when the original response or widget belongs to another agent. Missing sender agent stays silent rather than routing to the earlier owner; missing conversational context may produce a clarification response.
- Added bot with missing/disabled/stopping group agent stays silent for agent requests; enabled group-agent behavior is preserved.
- Responses and widget renders receive no injected URL markers in text, rich nodes or captions.
- Guest `send` uses existing message fields and returns its confirmed inline ID. Test the supported content conversions, source proof, prepared buttons and captions; incompatible destinations, uploads, unsupported content/options and invalid guest handles must fail before an effect without falling back to a private send. Ordinary `send` behavior/results remain compatible.
- A guest-request send checks request/agent ownership before publication and persists native inline ownership plus its view binding after confirmation. Existing inline-target attachment still rejects a foreign agent through the existing ownership conflict.
- End-to-end live check with the unchanged Wordle: explicit invocation -> one `set_widget_view` guest-send call -> the first visible response is already the widget -> working buttons and rerenders. No intermediate Wordle text message or mandatory first edit. This has not been run with the new guest handler.
- Activation-card variant: permits, duplicate presses, one-shot action admission, restart persistence, then conversion to the widget. A guest callback/address match was tested earlier, but full guest-to-widget conversion remains unverified.
- A render/format error before publication sends nothing. Direct Bot API sequential/concurrent repetition was tested: sequential repeats were rejected generically, concurrent initial answers both published. Verify the controller forwards authorized explicit repeats without a local count/consumed/in-progress guard; Telegram rejections retain their real errors, and multiple confirmed successes each retain independent ownership, snapshots and any view binding. Check competing plain-answer/widget-send calls, the unpublished render context, unsupported media/poll output, immediate callbacks and restart recovery during the confirmation/binding window.
- Unknown/failed publication, failed local ownership registration and failed first render must not produce a false success or an automatic duplicate publication.
- Finalize guest event/tool schemas, answer timing and authorization using the current controller architecture; reuse existing inline ownership/snapshot and widget view APIs rather than creating a separate guest widget system.
