# Guest Mode

A native guest invocation explicitly mentioning this bot is delivered to the author's existing enabled personal agent. No personal agent is created or enabled automatically. Without an available authorized personal agent, the invocation is left unanswered. A guest reply without a fresh mention does not continue another agent's conversation; a mention inside a reply selects its new author's own agent.

The controller saves the complete native guest message separately from ordinary chat history and enqueues a compact `guest_message` event with an opaque `guestRequestId`. The event follows the normal short-preview conventions, without ordinary message, reply or topic selectors. The guest chat's numeric address grants no permission to read history or send ordinary messages there. See [message events](message-events.md), [storage](storage.md) and [security](security.md).

A bot that is already a group member keeps its ordinary group-agent routing. If that group's agent is absent, disabled or stopping, there is no fallback to a caller's personal agent. Guest Mode and [inline mode](inline.md) are separate transports; typing `@bot` at the start can open inline selection in Telegram clients. Sending a normal message with a leading space before the mention avoids that client shortcut in the tested clients.

## Read and answer

The compact event can be enough to decide whether to answer. Full reads are optional:

```js
await read({guestRequestId:"REQUEST_ID"});
await send({guestRequestId:"REQUEST_ID",text:"Hello"});
// Confirmed result: {inlineMessageId:"OPAQUE_INLINE_ID"}
```

Use `guestRequestId` alone as the read selector; do not mix it with ordinary message IDs, chat IDs or an inline message ID. Full reads preserve available native attachments/reply context and readable dates. They do not fetch additional Telegram history. Independent sent invocations retain separate handles and destinations even in one model batch; a later invocation does not cancel an earlier one.

Guest output uses the supported existing content fields: text, `rich_message`, photo, animation, video, audio, voice, document, sticker, location, venue and contact. The controller supplies native envelope IDs/titles. Content/options must fit one native inline result. Use `buttons` or an inline `reply_markup` with existing action/permits/group definitions. For example:

```js
await send({guestRequestId:"REQUEST_ID",rich_message:{blocks:[
  {type:"paragraph",text:"Choose an action"}
]},buttons:[[{text:"Start",action:"Activate my widget on this inlineMessageId",group:"start"}]]});
```

Guest sends cannot include ordinary `chatId`, `topicId`, `reply_parameters`, notification/protection/effect options, uploads or local attachment references. Albums, polls, dice, video notes, ordinary reply keyboards, games and invoices have no supported conversion. Incompatible requests fail before publication and never fall back to the personal chat.

For generated files, send/upload to an authorized buffer chat first (default: current private user, `disable_notification:true`), then read its `file_id` and provide matching `file_sources`. Never use token-bearing Telegram file URLs. Incoming attachments remain downloadable with existing `download({fileIds})`.

```js
await send({guestRequestId:"REQUEST_ID",photo:"BUFFER_FILE_ID",
  file_sources:[{messageId:81,fileId:"BUFFER_FILE_ID"}]});
```

URL photos use the same URL as their default thumbnail. URL video/animation needs a public `thumbnail_url` and appropriate MIME metadata; URL documents support PDF/ZIP. Missing native metadata is an actionable validation error, not an implicit upload. Cached audio retains the stored-title requirement described in [inline media](inline.md#preparing-results).

## Widgets and callbacks

Create an owned React widget or choose an existing one, then mount a named component as the direct guest answer:

```js
const widget=await create_widget({handler:"widgets/wordle/widget.tsx",description:"Wordle",props:{wordMode:"individual"}});
await set_widget_view({widgetId:widget.widgetId,component:"GameShared",send:{guestRequestId:"REQUEST_ID"}});
// {viewId:"VIEW_ID",target:{inlineMessageId:"OPAQUE_INLINE_ID"}}
```

The first visible response is the rendered view. A guest view has no ordinary chat/message address, so `event.overlay` cannot create a private group overlay. Wordle's `GameShared` uses one shared message, individual answers and a short active-player lease. A native inline action card can instead prompt the agent to create a view after a click. Widget buttons route to the current React closure, not a named module action. Telegram may give different participants different opaque inline IDs for the publication; the controller never treats an unknown participant ID as a new canonical view registration.
A prepared one-shot action closes its group when the accepted event enters the agent queue. Its visible button changes when the agent edits or replaces the message, so it may remain visible while the agent prepares a widget. Further presses of the closed group do not enqueue another action.

## Lifetime and delivery

Guest requests, complete incoming messages, publication attempts and recovery receipts use the original request's 30-day local retention. Retained handles survive restart; queued model events remain volatile and are not replayed automatically. Expiry is silent. Live widget bindings and their required inline ownership retain their existing lifecycle exceptions.

An agent may leave a request unanswered, including ending its turn before optional background work. No placeholder, private failure message, reminder or rerun is generated merely for absence of an answer. The agent is instructed to send at most one response, but the controller does not enforce an answer-count limit. Telegram may accept two simultaneous answers; each confirmed message and view is saved independently.

Actual validation, Telegram or storage errors are returned by the publication tool. A generic invalid/expired-query error does not prove that an answer was already sent; known earlier successful IDs are included when available. Lost network confirmation is `delivery_unknown`; confirmed publication followed by failed local registration is `storage_failed` with the known ID. Neither triggers an automatic resend. Durable receipts repair local registration only, without overwriting newer confirmed edits or guessing a destination.

Telegram documents [answerGuestQuery](https://core.telegram.org/bots/api#answerguestquery) and [Guest Mode](https://core.telegram.org/api/bots/guest-mode), but the checked descriptions state no numerical answer deadline. Thirty-day storage is not a promise that Telegram will accept an answer after that delay. See [verification evidence](dev/guest-message-verification.md) for tested conditions and limits. Existing saved agent contexts may need explicit `/agent clear` for new instructions; no conversation is reset automatically.
