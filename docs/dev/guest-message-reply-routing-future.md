# Deferred guest reply routing investigation

Status: deferred on 2026-10-19. This preserves the earlier reply-routing proposal and its investigation for possible later versions. It is not the current implementation scope and does not authorize URL marker insertion. The user removed URL markers and guest reply handling from version 1, while retaining guest widget publication. The authoritative current design is [Guest Mode version 1](guest-message-concept.md). Future reply support needs a fresh design decision; the archived link mechanism is not automatically selected for that version. Historical capability evidence remains in [live verification](guest-message-verification.md).

## Earlier behavior (superseded for version 1)

- If the receiving bot is a member of the group, retain its existing ordinary-message/widget handling. An enabled chat agent handles eligible agent requests. If the chat agent is absent, disabled or stopping, do not answer those requests and do not invoke a personal agent instead. Existing service/management command handling is outside this agent-dispatch rule.
- Personal routing applies to Guest Mode when the receiving bot is not a member. Do not add personal-agent fallback to ordinary `message` handling. Known member status also prevents a guest-path bypass of a disabled chat agent.
- A new eligible guest mention invokes the sender's current personal agent. If none is available, leave the request unanswered.
- Within the guest route, a reply to a marked response invokes the personal agent identified by that response's owner marker, independently of the latest caller. Widget markers instead identify their view. A marker on an ordinary group message does not enable personal fallback in a member chat.
- Preserve the selected owner's identity through further replies. Sender identity and agent ownership remain separate; selecting an agent does not grant its owner's private authority.
- Add the link marker to every agent-produced message where supported and where the controller knows the personal agent owner or the widget view. Coverage includes plain text, rich content and supported media/file captions. Do not invent a personal owner for an ordinary agent without such ownership; a widget can use its known view ID without such a personal-owner field.
- If a message cannot carry the marker, send it without the marker. Do not replace it with an extra attribution message or button merely to carry routing data.
- If the agent cannot be determined from a reply, ignore the reply. This includes absent, invalid or conflicting owner markers and an unavailable target agent. Do not guess from content, dates or the latest caller.
- Recognize external replies and quotes as reply-shaped input even when `reply_to_message` is absent. An accompanying mention must not silently turn an unresolved reply into a new caller-owned conversation. `TextQuote` does not preserve `text_link` entities, so a quote alone cannot supply the selected hidden URL marker; ignore unresolved cases under the same rule.
- Editing and widget rendering must preserve or regenerate the appropriate routing marker whenever the resulting format supports it; supported paths must not accumulate duplicate markers.

## Owner link

For an ordinary response, the URL contains `ownerUserId`, not a random per-publication token, for example:

```text
https://t.me/example_bot?start=g_123456
```

The controller derives the owner ID from the selected agent and constructs the link. Resolve `(receiving bot, ownerUserId)` to that owner's current personal agent. Old responses therefore address the current personal agent after replacement/recreation; they do not identify a particular historic generation, publication or conversation.

Before using a marker from incoming quoted content, verify that its source is an eligible response of our bot and validate the marker's structure. Its publicly readable URL is routing metadata, not a secret or an authorization token. The exact source checks for different publication paths belong to the implementation design.

The user selected best-effort marking across supported formats. A native private-message preflight preserved U+200B and U+2060 text links, a U+2060 rich link and a U+2060 document-caption link. Live plain-text guest replies preserved the exact U+2060 owner link first in a same-user control and then across A -> B -> A callers in the current supergroup. B's subsequent replies to A's native rich message and document caption retained the exact URL through the rich link representation and `caption_entities`, respectively, and both selected A. The user reported A and no visible links for those controls; the first plain-text display check also reported no preview. Explicitly identified Desktop/Android coverage remains unrecorded.

## Carrier evidence and remaining checks

A `text_link` entity can carry the owner URL separately from its text. Candidate invisible anchors are a deliberately inserted U+200B or U+2060 character. Attaching a link to existing punctuation is an alternative with potentially visible link styling, not the chosen invisible implementation.

An empty anchor is not reliable: TDLib removes zero-length entities in `MessageEntity.cpp::remove_empty_entities`. A nonempty zero-width anchor must be tested for server acceptance, actual rendering and preservation in guest replies. It still changes the underlying text even if no extra glyph is visible.

Acceptance evidence and remaining work:

- Passed live: plain text through native entities, with the exact owner URL retained across two users.
- Passed live: native rich content through its supported URL link representation.
- Passed live: document captions through caption entities. Other media/caption variants remain untested in this investigation.
- Passed live: inline plain-text editing preserves the marker in the next cross-user reply. Rich/caption edits and widget rerenders remain untested.
- User reported no visible links for text/rich/document and no preview for the initial plain-text control. Separate named Desktop/Android checks are not recorded.
- Pending production checks: unsupported content and content limits must preserve user content and fall back to an unmarked send instead of truncating to force a marker.
- Pending production regression coverage: missing/malformed/conflicting markers and unavailable owners must remain silent. The disposable runner's unresolved-external-reply correction passed offline; it was not reaccepted live on the old external target.

Initial native private-message experiments compared U+200B, U+2060 and a visible punctuation control: Telegram accepted all three and returned the exact marker URL. Guest-reply controls used U+2060; U+200B was not tested in a guest reply. Its same-user and fresh cross-user plain-text, native-rich, document-caption and edited plain-text controls passed. Explicitly identified client coverage and the other checks above remain open. No probe poller is running; temporary test infrastructure is not deployed support.

## Widget conversion: view marker accepted, dispatch details proposed

An inline message converted to a widget remains an owned inline publication. Existing button callbacks carry its inline ID and already resolve through `store.byTarget`; hidden-link routing must not replace widget callback dispatch or turn button presses into model events.

The controller should decorate each supported widget render with its routing marker after the widget produces native content, preserving the handler's existing formatting and actions. Unmodified handlers, including the supplied Wordle, should not need to emit routing metadata. If the output format cannot carry a link, render without one as already accepted.

The user selected `viewId` as the only widget-specific identifier in a widget marker. The existing view registry resolves `viewId` to `widgetId`, `agentId` and the message target, so neither owner user ID nor inline message ID needs to be duplicated in that marker. The receiver must still verify the view belongs to its bot and apply current ownership/status checks. The exact URL syntax remains to be finalized. Conversion to a widget replaces the ordinary owner-user marker with the view marker; the controller emits it on every supported render without changing the widget source.

Proposed intake order for a delivered guest reply is: validate marker/source, resolve the publication, check its current view/widget ownership and status, then use the widget's ordinary `onReply` event path if it has that hook. Preserve sender identity, source view snapshot, shared queue admission and replacement/stop rules. The current ordinary-message path falls through when an active widget lacks `onReply`; forwarding such a guest reply to its identified owner agent is proposed as the analogous behavior, not yet accepted. Handler failure must not trigger this fallback.

Stopped, detached, deleted or unresolved widget targets must not wake the owner agent as an automatic fallback. The user selected rerendering on view replacement instead of maintaining aliases between old and new view IDs. The replacement render must contain the new view's marker as part of the same message update; do not require a second post-commit edit just to repair the marker. Commit the new binding only after confirmed publication, retaining the old binding on failure or uncertainty according to the existing widget contract. No old-view-to-new-view alias registry is introduced.

Already-admitted message-directed replies retain the existing continuous-replacement queue semantics and source snapshots. A newly received reply whose marker names a view that no longer exists is unresolved and is ignored under the accepted unknown-target policy; do not redirect it to the owner agent or revive the retired view. These intake rules do not replay stopped or detached events.

The completed guest probe covered replies to messages posted by `answerGuestQuery`. A separate live control is needed for replies to a user-posted native inline card, especially after conversion to a widget. A marker does not cause Telegram to deliver updates that the bot otherwise would not receive. Neither reaction delivery nor access to the destination chat is implied by guest-reply routing.

## Established Telegram observations

- `Update.guest_message` carries the incoming question and, for the tested replies, its directly quoted Message.
- `guest_bot_caller_user` identifies the caller of that particular bot response, not the original conversation owner after different people continue it.
- In the tested basic group, two users replying to the same response exposed the same guest chat context but different ordinary message IDs. A shared ordinary address cannot identify that publication across those two callers.
- Quoted replies contained no inline ID or nested ancestor chain. The original logger recorded the presence of dates, not their values; quoted-date equality across users has not been measured.
- Exact opaque callback data survived in quoted reply markup, and a real button callback carried the inline ID returned by the guest answer.
- The plain-message experiment preserved ownership using unique diagnostic fixture text. It did not establish arbitrary unmarked-message ownership.
- In the hidden-link follow-up, B's reply to A's original response arrived with `external_reply` and `quote`, without `reply_to_message`, in a new `supergroup` context rather than the original `group`. The disposable runner initially misclassified it as a fresh request and answered B; that fallback was corrected offline. The user confirmed both accounts operate in the same group, with only probe commands sent privately. Basic-group migration is consistent with this observation, but no migration service event or explicit mapping was captured. A completely fresh A request and B -> A reply chain then shared the same current supergroup ID, carried native `reply_to_message` and preserved A's exact URL in both replies. Caller metadata changed to B while marker ownership remained A. The user confirmed all three answers were A. There is no evidence here for generally caller-specific guest chat identifiers or loss of links in ordinary cross-user replies.

## Membership and existing chat agents: accepted precedence

The user raised invocation in a chat that already contains a bot, with or without an agent. Distinguish the same receiving bot already being a member from a different bot being present. Another bot's agent is not part of this bot's ownership namespace; no implicit cross-bot dispatch or coordination is selected.

Telegram membership and the application-level existence of a chat agent are different facts. The current production ordinary-message route saves known chat history and dispatches trigger messages only when that chat's agent is enabled. The initial guest probe used a nonmember bot. In the subsequent member control, Telegram reported the bot joining the current supergroup as a normal member; A and B then sent new mentions with the synthetic chat-agent flag off. Both arrived exclusively as ordinary `message` updates without a guest query ID, and the disposable runner replied through ordinary `sendMessage`, selecting A and B respectively. No corresponding guest update or duplicate reply was observed for these two actions. Do not generalize that limited observation into a universal no-overlap guarantee, assume a numeric guest chat ID alone establishes an ordinary route, or merge guest input into normal history automatically.

The latest accepted simplification is membership-based: an added bot uses the group's existing ordinary agent path. If that chat agent is disabled/stopping or absent, agent-triggering mentions and replies remain unanswered; do not wake a personal agent, including one named by a valid reply marker. Existing service commands and widget handling keep their ordinary semantics. Personal-agent selection is implemented only for nonmember guest input. This supersedes the earlier proposal to add a personal fallback for ordinary member messages when no chat agent exists.

The live member-without-chat-agent control proves that an ordinary personal fallback is technically possible, but that behavior is now explicitly out of scope. Ordinary updates have no guest query ID and remain in the existing ordinary controller path. No new personal send permission or ordinary-history projection is needed for this discarded scenario. Guest-route authorization, event projection and trustworthy membership/context classification still need implementation design; do not identify an ordinary chat merely by a matching numeric guest ID. One action must not independently wake both a group agent and a personal agent.

The first member-bot mention control passed without a synthetic chat agent. With the synthetic chat-agent flag enabled, new mentions from A and B and B's reply to a prior personal-owner-marked response all selected CHAT. The executed reply target was B's prior ordinary response, identified by its native message address; CHAT took precedence despite its valid personal owner marker. All three were ordinary updates with one confirmed ordinary reply each and no observed guest duplicates. The user confirmed CHAT. This tests transport and dispatch mechanics without a model or production agent records, and does not exercise disabled/stopping agents or real widget interception. After acceptance, the bot left the test group and the bounded poller stopped.

The new member-silence rule was recorded after these capability tests, without restarting them. Production regressions must check that both missing and disabled/stopping chat agents stay silent and never fall back to personal agents, including for replies carrying valid personal-owner markers.

## Inline-address ownership

After confirmed `answerGuestQuery`, saving `(botId, inlineMessageId) -> agentId` is feasible without adding metadata to the published message. Existing `src/inline/store.mjs` provides `inline_message_owners` and owner/conflict checks; a future guest handler can claim the returned address without waiting for a callback.

This exact registry remains useful for edits, widgets and callbacks. A user-ID marker resolves an agent, not a specific inline publication. A textual guest reply does not supply its quoted inline ID, so that registry alone does not identify an unmarked reply target. Uncertain sends may publish without returning the address; Telegram publication and a local database write are not atomic.

## Earlier alternatives

Per-publication random references and metadata-free fingerprints were investigated but are not selected for basic reply routing. Natural-field matching could compare bot/context, quoted caller, date and normalized content against a publication journal. Identical responses from different agents can still coincide, and the guest answer does not return the exact server date. That approach would require explicit handling of clock uncertainty, uncertain sends, revisions, retention gaps and ambiguity. The accepted current policy instead ignores replies whose owner cannot be resolved through the supported marker.
