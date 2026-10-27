# Hidden correspondence with a chat agent

Queued `/say` participates in [oldest-chat eviction](agent-control.md#overflow-and-recovery). Eviction edits only its confirmed prepared private response to a queue-removal error; there is no public fallback or ordinary `historyGap`. Duplicate delivery stays terminal. Cancel retains admitted waiting private requests; fencing applies to cancelled compute work rather than those queued source receipts.

[Wiki home](index.md) · [Commands](commands.md) · [Message events](message-events.md) · [Messaging](messaging.md)

## `/say`

In a group or supergroup with an enabled agent, `/say MESSAGE` delivers hidden correspondence to the existing chat agent. It requires this bot's application role `user` or higher, independently of Telegram administrator status. It uses the ordinary chat queue, ten-entry limit, batching, steering and shared context. Hidden input grants no extra instruction authority, priority or permissions and does not open public listening. It does not enable an agent or create a personal session.

Telegram must deliver the command as ephemeral. The registered group command lists include `/say`; an ordinary command from a stale client is refused rather than treated as hidden. In private chats, direct messages already provide a private route; `/say` is a group command. The prefix/leading separator whitespace are removed and remaining formatting offsets are adjusted. This free-form message is not parsed as administrative command arguments.

The controller immediately sends `Request received.` privately. This differs from the five-second processing timer for controller commands; file invitations remain fresh and unedited. A confirmed response address accompanies the queued event:

```json
{
  "eventType": "message",
  "date": "2026-10-20T12:00:00.000Z",
  "from": {"userId": 123, "name": "Alice"},
  "triggers": ["/say"],
  "ephemeralMessageId": 456,
  "textPlain": "Give me a private hint",
  "preparedReply": {"ephemeralMessageId": 789, "receiverUserId": 123}
}
```

The outer ID identifies incoming user content; `preparedReply` identifies a different outgoing bot message. Neither becomes an ordinary `messageId:0`. Normal short-message date, author, topic, formatting and truncation fields apply. Failed or uncertain preparation still delivers the event, with `replyPreparationError:{error,description}` instead of a fabricated prepared address.

## Controller file browsing

The [`/browse`](commands.md#interactive-file-browser) interface supports controller-owned ephemeral rich buttons and fixed-destination upload invitations for admin/owner users. These callbacks are independent of agent/widget delivery. Agent-tool limitations below still apply.

## Agent tools

```javascript
await read({ephemeralMessageId: event.ephemeralMessageId});
await edit({...event.preparedReply, text: "Your private hint"});
await delete({...event.preparedReply});
await send({text: "Private reply", reply_parameters: {ephemeral_message_id: 456}});
await send({text: "Private message", ephemeral_message_parameters: {receiver_user_id: 123}});
```

Names denote the corresponding discovered controller tools. `read` returns the usual `messages` wrapper with complete saved content. Incoming reads omit `receiverUserId`; outgoing bot-response reads/edits/deletes include it. Optional `chatId` must be the current chat. Ordinary, inline, guest and ephemeral selectors cannot be mixed. Only the originating agent can access the snapshot; edits/deletes require a bot-authored outgoing message. Deleted, expired and known reused addresses are unavailable.

For native replies, the recipient is inferred from the owned incoming snapshot; an explicit recipient must match. Telegram documents a 15-second limit for direct ephemeral replies, which must themselves be ephemeral. Administrators may send a separate hidden message without that target after the deadline. Telegram makes the delivery/permission decision; no public fallback or automatic uncertain retry occurs. Editing the prepared response avoids relying on a fresh reply after a queue delay.

Private `send` returns `{ephemeralMessageId,receiverUserId}` instead of ordinary `messageIds`. It supports text/rich content, photo, video, animation, document, audio, voice, sticker, video note, static location, venue and contact, including automatic local uploads via `file:path` in structured media fields and existing file IDs. Native private `send` does not support interactive buttons, albums, polls, dice, live locations or live-photo sends. Interactive hidden widgets use [`set_widget_view`](widgets/views.md) with a new recipient-only `{chatId,receiverUserId}` target. Proactive sends require the bot to be a group administrator. Private edits support text/rich content, media, captions and empty keyboard updates. Reconstructed media/formatting snapshots can be partial; local reads do not fetch Telegram history. An uncertain edit marks `deliveryUnknown` and is not automatically repeated.

The agent chooses private or public output according to the request. Public output uses ordinary `send` without a private target; an unused prepared response may be deleted. Shared context is not a separate private model session: the agent is instructed to keep hidden content confidential unless the user requests disclosure or an authorized public action. Private tool failures instruct it to remain silent rather than announce the failure publicly. Private agent-turn failures suppress the usual public controller error notice.

## Storage and lifecycle

Private snapshots, preparation state and queue-admission markers use separate SQLite storage with 30-day retention and originating bot/chat/agent ownership. They are excluded from ordinary history/search. Confirmed prepared addresses survive controller restart independently of Telegram client visibility. Local retention never guarantees client delivery or visibility.

Duplicate input does not prepare or enqueue again. Persisted preparation intent prevents resending an interrupted/uncertain preparation. Admitted events remain RAM-only, like ordinary chat events, and are not replayed after restart. Role, lifecycle and enabled state are rechecked before delayed admission/dispatch. Shutdown/removal prevents late admission. Known native-address reuse is quarantined rather than overwriting a different generation; this protection is limited to retained, observed addresses.

See the [development report](dev/ephemeral-command-verification.md) for automated and live evidence. Native constraints: [reply parameters](https://core.telegram.org/bots/api#replyparameters), [ephemeral response permissions](https://core.telegram.org/bots/api#ephemeral-messages-and-commands).
