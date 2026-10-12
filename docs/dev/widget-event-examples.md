# Widget event examples (design)

Illustrations of the proposed envelope, not an implemented SDK. Telegram payloads below are shortened examples; production keeps the corresponding native data subject to the accepted event size limit. Shared values are fictional:

```js
const base = {receivedAt: "2026-10-12T10:00:00Z", delayed: false};
const user = {id: 123, is_bot: false, first_name: "Igor"};
const chat = {id: -1001234567890, type: "supergroup", title: "Example"};
const date = 1791799200;
```

## Button → exported vote(ctx, event)

```js
const buttonEvent = {
  ...base, name: "vote", source: "button", user,
  data: {
    id: "callback-1", from: user, chat_instance: "example-instance",
    message: {message_id: 42, date, chat, text: "Choose"},
    data: "vote"
  }
};
// Runtime additionally provides event.respond(), not serialized JSON.
// await event.respond({text: "Vote accepted", showAlert: false});
```

Controller validates the button against the current message/registration registry before dispatch. Disabled callbacks are acknowledged empty and never replayed.

## Reply → onReply(ctx, event)

```js
const replyEvent = {
  ...base, name: "onReply", source: "reply",
  data: {
    message_id: 57, date, chat, from: user, text: "Add me",
    reply_to_message: {message_id: 42, date, chat, text: "Participants"}
  }
};
```

For a forum message native data also includes `message_thread_id` when Telegram supplies it. The normalized owner message context remains available in ctx.message. Controller commands have priority over widget reply routing.

## Reaction → onReaction(ctx, event)

```js
const reactionEvent = {
  ...base, name: "onReaction", source: "reaction",
  data: {chat, message_id: 42, date, user,
    old_reaction: [], new_reaction: [{type: "emoji", emoji: "👍"}]}
};
```

Anonymous aggregate counts use the same source/handler with native count data:

```js
const reactionCountsEvent = {
  ...base, name: "onReaction", source: "reaction",
  data: {chat, message_id: 42, date,
    reactions: [{type: {type: "emoji", emoji: "👍"}, total_count: 3}]}
};
```

Do not fabricate a user for aggregate counts; individual updates may instead contain actor_chat. The native shape identifies the variant.

## Poll state → onPoll(ctx, event)

```js
const pollEvent = {
  ...base, name: "onPoll", source: "poll",
  data: {
    id: "poll-1", question: "When shall we play?",
    options: [
      {persistent_id: "opt-1", text: "Today", voter_count: 3},
      {persistent_id: "opt-2", text: "Tomorrow", voter_count: 1}
    ],
    total_voter_count: 4, is_closed: false, is_anonymous: false,
    type: "regular", allows_multiple_answers: false,
    allows_revoting: true, members_only: false
  }
};
```

State is a poll snapshot, not an identified user's vote. Current Bot API fields include persistent option IDs; preserve fields provided by the actual deployed API rather than inventing absent ones.

## Poll answer → onPollAnswer(ctx, event)

```js
const pollAnswerEvent = {
  ...base, name: "onPollAnswer", source: "poll_answer",
  data: {poll_id: "poll-1", user,
    option_ids: [0], option_persistent_ids: ["opt-1"]}
};
```

An empty option list represents vote retraction. The native identity can be voter_chat instead of user. Poll-answer updates are not a list of voters for anonymous polls.

## Agent → exported updateImage(ctx, event)

```js
const agentEvent = {
  ...base, name: "updateImage", source: "agent",
  data: {src: "file:images/result.png"}
};
```

Controller creates the envelope for a widget_event tool call. Caller cannot spoof source/time/identity by putting envelope-like fields in data.

## Another widget → exported refreshResults(ctx, event)

```js
const widgetEvent = {
  ...base, name: "refreshResults", source: "widget",
  fromWidgetId: "w-other",
  data: {winnerUserId: 123}
};
```

Same owner-agent scope, existing controller permission checks; fromWidgetId is controller supplied. Disabled recipients reject agent/widget events.

## Local → exported tick(ctx, event)

```js
// ctx.setInterval(() => ctx.enqueue("tick", {now: Date.now()}), 60_000);
const localEvent = {
  ...base, name: "tick", source: "local",
  data: {now: 1791799200000}
};
```

Timer and script-owned WebSocket callbacks both use local enqueue. There is no separate controller ws_* delivery implied here. Local data may contain non-serializable JS references; this illustrative object does not constrain it to JSON. Local queue is not restored after unload/crash.

## Delayed delivery and queue counters

Restored external backlog keeps receivedAt unchanged and sets delayed:true. Ordinary waiting behind a busy handler alone does not set it. Example context queue information: `{pending:12,dropped:3}`; proposed dropped lifetime is cumulative since registration creation. Lifecycle hooks onInit/onCreate/onStop/onError have their own signatures and are not extra event sources.

## Latest known message before dispatch

The user requires ctx.message reactions to be refreshed before onReaction. Refresh means the latest known controller projection, not a guarantee of real-time Telegram state. Native reaction-count updates may be delayed, and individual updates do not always establish complete totals. Apply updates to the canonical saved message on receipt; replaying a delayed event must not apply its delta a second time.

Agreed poll equivalent: update ctx.message.poll from a received native Poll before onPoll. PollAnswer contains only a voter's changed selection, not the full Poll snapshot. Before onPollAnswer retain that known answer and expose the latest known message, but do not claim its native poll totals include this answer until an authoritative Poll update arrives. The separate local known-answers projection is agreed; its schema and bounds remain open in the [consolidated specification](widgets-spec.md). There is no full voter-list guarantee or blind increment of snapshot totals. Payload/event examples above do not imply a new getPoll API.

## Native references

[CallbackQuery](https://core.telegram.org/bots/api#callbackquery), [Message](https://core.telegram.org/bots/api#message), [MessageReactionUpdated](https://core.telegram.org/bots/api#messagereactionupdated), [MessageReactionCountUpdated](https://core.telegram.org/bots/api#messagereactioncountupdated), [Poll](https://core.telegram.org/bots/api#poll), [PollAnswer](https://core.telegram.org/bots/api#pollanswer). Verified against the current reference on 2026-10-12; examples describe a design, not current controller behavior.
