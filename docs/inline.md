# Inline agent results

Inline mode lets a user type `@bot query` in Telegram and choose a prepared result to publish in that chat. The controller routes the request to the user's existing, enabled private-chat agent. It does not create or enable an agent; without one, the inline header offers **Open bot**. In the bot's private chat, `/start` and `/start inline` explain how to enable the agent with `/agent start` and begin a new inline query. Opening the bot does not enable the agent automatically; existing access restrictions still apply.

Telegram supplies query text, the invoking user, an opaque pagination offset and sometimes `chat_type`. It does not supply text entities, attachments, reply context, destination chat ID or history. The model event therefore contains no destination address:

```json
{"eventType":"inline","requestId":"REQUEST_ID","query":"Publish Wordle","chatType":"group","expiresAt":"2026-10-18T12:00:00.000Z"}
```

The author is the private agent's current conversational partner. `chatType` is context, not access to that chat. Telegram client behavior and supported fields are described in the [official inline API](https://core.telegram.org/bots/api#inline-mode).

## Pagination and lifetime

Initial and fast automatically requested pages say **⬇️ Scroll to send command [hh:mm:ss]**. Before submission, page sizes follow **6, 6, 20, 20, 20…**, resetting for each new initial query. The timestamp is the page's generation time in UTC; previously delivered rows keep their original time. A pagination request received at least 2,000 ms after its cursor was issued submits the instruction once and immediately returns one **⬇️ Command sent to agent** item. This is a timing heuristic, not proof of a physical user scroll. Subsequent waiting pages wait up to 5,000 ms, waking earlier for results, then return one **⬇️ Agent is working** item. The down arrow marks service items that require further scrolling; final results and **Work complete** have no added arrow. Only an accepted `set_inline_results` call with `done:true` (the default) finishes preparation; ending a model turn does not. With no queued items and input still open, the same waiting policy applies between portions.

When available, the first item on the first page uses the child bot's avatar as a cached-photo preview; it still sends only `✖️` when selected. It occupies one of the six rows, rather than adding a seventh. All subsequent service items are ordinary articles. If the child has no available avatar, the controller tries the [master bot's avatar](master-bot.md#inline-preview-fallback). Both are requested through the child token using `getUserProfilePhotos`; `getChat().photo` returns a different file type that Telegram rejects for this purpose. Profile lookups, including absence/errors, are cached per child bot for five minutes and concurrent requests share the lookup. Each API lookup has a 1,500 ms timeout. If neither avatar is available, the controller serves the ordinary drum. Avatar changes can take up to five minutes to appear; a controller restart clears the cache.

All requests/results are RAM-only, with one common one-hour lifetime from creation. A new initial query from the same user replaces the old request, even with identical text. Pending model jobs are cancelled when possible; running model work is not killed, but its late results/buttons are rejected. Disable/revocation closes servicing. Restart loses active inline requests; it does not restore their text/results. There is no query/answer cache.

Prepared results wait in RAM until the user requests a page. Only that page's action definitions are written to the database, immediately before answering Telegram. Pages contain at most 50 results; total result count is not capped. Each accepted `set_inline_results({requestId,results,done})` appends a fully validated portion. `done` is an optional boolean, defaulting to `true`: it closes input while queued items continue to drain. Use `done:false` for intermediate portions. Calls after input closes return `already_set` without validating or adding their contents. Invalid portions have no partial effects and do not close input. Expired/replaced requests return `request_unavailable`.

Ready items are issued immediately, ahead of any working placeholder. Empty nonfinal portions do not wake a waiting page. An empty final portion wakes waiting pages and closes pagination after earlier items drain. It adds no visible completion row, so an earlier Agent is working item can remain last in the list even after the terminal empty page. To give a visible completion signal, append a final omitted-message status card with done:true. **Work complete** appears only if no item was ever accepted. There is no portion deduplication or batch ID: repeating a nonfinal submission can add duplicate results. Authored result IDs are validated within each portion, then replaced by fresh controller wire IDs for every accepted item.

Page allocation is serialized per request. Repeating an offset replays the original successful page with the same result IDs, buttons and next offset; it does not consume another portion, re-register buttons, reopen a consumed button group or refresh the cursor issuance time. Replay pages remain in RAM only for the original request lifetime and are discarded with the request. A delivered stream can replay its existing pages until expiry/replacement, but cannot accept more portions.

Any `answerInlineQuery` or registry database error ends servicing, without an automatic retry. Already committed button records remain after an uncertain answer. Each Telegram answer uses `cache_time:0` and `is_personal:true`; this does not guarantee a prepared result can only be posted once.

Placeholder items, and friendly results with no `message`, publish only **✖️** if selected. Friendly omitted-message cards are also the format for intermediate reports: agents supply `title` and optional `description` without drawing an arrow. At delivery the controller prefixes their titles with **⬇️** if other items remain after them or input is still open. The last item of a completed stream gets no added arrow. Descriptions and publishable message content are unchanged. Native media/articles are not status cards merely because their outer object has no `message`. Previously returned rows cannot be removed or replaced through pagination; their original arrows remain.

Config overrides are `inline:{triggerMs,waitMs,promptRows}`. `promptRows` accepts an integer from 1 to 50 for fixed-size pages, or a nonempty array of up to 50 such integers for a page-size sequence; the final entry repeats. Its default is `[6,6,20]`, copied into each request's immutable policy. Existing numeric overrides remain supported. These are server-side policy values, not Telegram client debounce settings. The 2,000 ms submission threshold is retained to allow for network delays; it cannot rule out delayed automatic requests. See [calibration evidence](dev/inline-calibration-results.md): the variable-size control stopped at 42 cumulative rows on Desktop and 12 on Android. The accepted 6,6,20 sequence is a subsequent policy choice, not an exact minimum or a universal client guarantee. The tested Desktop hid photos in mixed pages; separate photo pages with one and three photos displayed and sent on both Desktop and Android.

Desktop's preview-column layout can depend on the first page: the inspected [client source](https://github.com/telegramdesktop/tdesktop/blob/b16daff6df63e8a812bc2b52a04ff243f67a7d3f/Telegram/SourceFiles/inline_bots/inline_results_inner.cpp#L589-L605) chooses thumbnail mode when creating an empty result list and retains it while appending pages. A paired Desktop live control with identical later pages reproduced invisible cached photos after a thumbnail-free first page and visible photos after a first page with thumbnail URLs. A subsequent control with one actual bot avatar as the first cached-photo item, then plain articles, displayed both later mixed photos on Desktop and Android; selecting the header sent neutral text. The controller retains separate photo pages for compatibility when avatars are absent or unavailable. Earlier compact-row measurements do not establish automatic loading thresholds for the taller avatar layout. This client detail is not a Bot API layout guarantee.

## Preparing results

Use the controller tool, not a normal final answer:

```js
await set_inline_results({requestId:"REQUEST_ID",results:[{
  title:"Wordle",description:"Start a shared game",
  message:{text:"Wordle",buttons:[[
    {text:"Start",permits:{"*":null},group:"start",
     action:"Create widgets/wordle/widget.tsx and attach it to this inlineMessageId."}
  ]]}
}]});
```

During long work, append intermediate reports and results as they become ready. Do not add arrows yourself:

```js
await set_inline_results({requestId:"REQUEST_ID",results:[{
  title:"Preparing three images in sequence.", description:"Images will appear as they become ready."
}],done:false});
// Generate/send/read the first authorized image buffer, then:
await set_inline_results({requestId:"REQUEST_ID",results:[{
  native:{type:"photo",photo_file_id:"ACTUAL_FIRST_FILE_ID"},
  file_sources:[{messageId:123,fileId:"ACTUAL_FIRST_FILE_ID"}]
}],done:false});
// Append further prepared results. Explicitly close input when finished:
await set_inline_results({requestId:"REQUEST_ID",results:[],done:true});
```

The completion flag does not push a page to an idle client. New results appear only when Telegram requests another page. Selecting one result publishes that item, not all results accumulated for the request. A partial failure can be reported with a final omitted-message card and `done:true`; already accepted portions remain available. A Desktop live probe displayed all three incrementally delivered photos with intervening status/wait pages and correctly ended on the final photo. In that observed layout a photo and the subsequent waiting article shared a visual row despite being returned on separate pages. Page separation does not prescribe client row grouping. The Android incremental-photo probe displayed one result per visual row and successfully sent a selected photo. Desktop also passed immediate-ready photos, terminal status selection, empty late completion and query replacement; see the [verification report](dev/inline-streaming-verification.md). These are observed client behaviors, not a universal layout guarantee.

Friendly cards have `title`, optional `description`, `id`, `url`, thumbnail fields and `message`. Message fields support text/entities or parse mode, native `rich_message`, link previews, and `buttons`. A flat button list is one row; a matrix specifies multiple rows. Rich button blocks accept one to eight buttons per row. Use `rich_help` for current Telegram structures.

A result can instead use `{native:{...},file_sources:[...]}` with native `type`/`id` and the corresponding [InlineQueryResult](https://core.telegram.org/bots/api#inlinequeryresult) fields. Supported URL variants are article, photo, GIF, MPEG4 GIF, video, audio, voice, document, location, venue and contact. Cached photo, GIF, MPEG4 GIF, sticker, document, video, voice and audio variants are supported too: 19 nongame variants. Native text, rich, location, venue and contact InputMessageContent are accepted. Games, invoices and payment buttons are excluded. URL documents require supported PDF/ZIP MIME types. Prepare photos last within each portion: the controller moves every native `photo` result, cached or URL, after that portion's other results. Order within both groups and action definitions are preserved; portion order is never globally rearranged. Photo and nonphoto groups start separate pages, including when a new portion follows previously queued photos; each page still contains at most 50 results. Photos are never mixed with other result types on a page, because the tested Desktop hid photos even at the end of mixed pages. Other mixed types remain supported. This compatibility policy does not establish visibility on every client.

Cached audio needs a nonempty title stored with the uploaded audio. Use `send({audio:"attach://clip",title:"Clip",uploads:{clip:"wiki/clip.mp3"},disable_notification:true})`, then read the saved `audio.title` and `audio.file_id`. Live Telegram rejected a titleless cached MP3 with `AUDIO_TITLE_EMPTY` even when the inline result had a nonempty `title`; reuploading the same MP3 with a title succeeded. Cached results also accept `title`, `performer` and `audio_duration` through the [Bot API parser](https://github.com/tdlib/telegram-bot-api/blob/master/telegram-bot-api/Client.cpp), but those fields do not repair missing stored metadata. In the tested clients, cached-audio previews displayed the stored title/performer rather than the assigned inline-result title, so set display metadata when preparing the buffer. The agent receives this preparation guidance.

## Buttons and delivery

Action buttons contain self-contained `action` text, `text`, optional `key`, `group` and `permits`. The controller assigns opaque `btnId`, shared card `tipId` and wire callback data. Never put action instructions or secrets directly in `callback_data`. Ordinary URL/copy/disabled/switch-inline controls retain their native behavior.

Permits use existing exact/longest-terminal-wildcard matching against the local callback key. `{"*":null}` allows everyone, `{"*":[123]}` allows selected users, and an unmatched key denies. An omitted permits map allows everyone; the agent chooses any author-only restriction explicitly. Invalid/expired/unauthorized presses are acknowledged silently.

A group is one-shot globally across all posted copies of that card. Group closure and durable event creation are atomic; no group means repeatable. First queue admission counts as delivery; there is no model acknowledgement or replay after it. If the model fails, the user can create another inline message. The button event goes to the preparing agent, while `from` identifies the actual person who pressed:

```json
{"eventType":"button","eventId":"EVENT_ID","inlineMessageId":"OPAQUE_ID","from":{"userId":123,"name":"Alex"},"action":"Activate Wordle on this message","btnId":"BUTTON_ID","tipId":"CARD_ID","btnGroup":"start"}
```

There is no invented ordinary `messageId`, chat ID, button label or view ID in this event. A callback establishes ownership. The agent may then use `set_widget_view` to turn that message into a [widget](widgets.md). Subsequent widget callbacks run code directly without a model turn. A known active/stopped widget binding intercepts its own callbacks and blocks ordinary edits.

An inline callback does not establish an ordinary chat/message address or subscription to that destination. In the tested fresh nonmember group, a button callback arrived while publication, replies and reactions did not produce ordinary updates. Use buttons for interaction at unknown inline destinations; do not promise widget reply/reaction hooks solely from an inline ID. Telegram additionally requires administrator status and explicit subscriptions for [reaction updates](https://core.telegram.org/bots/api#update). See the [bounded observation](dev/inline-unknown-events-verification.md) for its conditions and limits.

## Inline read/edit and media

`read({inlineMessageId})` reads only this controller's saved confirmed edits; Telegram cannot fetch an arbitrary inline message by ID. Before any edit the content can be unknown. Reads return `partial:true` unless the stored components establish a complete snapshot. Ordinary `read({messageIds,chatId?})` remains separate. Ownership is checked for all inline writes/reads; another agent cannot take the message.

`edit({inlineMessageId,text:...,buttons:[...]})` or native rich/media fields edits in place. Each confirmed component updates the snapshot. Replacing content clears obsolete formatting and captions instead of merging them into the replacement. An uncertain edit keeps the last confirmed content with `deliveryUnknown:true`; it is not replaced by guessed content or retried. Do not address an observed `via_bot` message through ordinary chat/message IDs: ordinary edits, including permits-only edits and ordinary widget attachment, are blocked for all such messages. Permitted ordinary deletion remains available. Short events include `viaBot:"username"` or `true` without changing the sender.

Inline output/edit cannot upload local files or use `attach://`. To create a file/image, explicitly generate/save it, send it to an authorized buffer chat, read that outer message, and use its Telegram `file_id` with matching `file_sources`. By default use the current user's private chat with `disable_notification:true`; the user may specify another permitted buffer. Buffer messages are not automatically deleted.

```js
const sent=await send({photo:"attach://image",uploads:{image:"wiki/cat.png"},disable_notification:true});
const outer=await read({messageIds:sent.messageIds});
// Select the actual photo size/file_id from outer.messages, then:
await set_inline_results({requestId:"REQUEST_ID",results:[{
  native:{type:"photo",id:"cat",photo_file_id:"ACTUAL_FILE_ID"},
  file_sources:[{messageId:sent.messageIds[0],fileId:"ACTUAL_FILE_ID"}]
}]});
```

Every agent-provided reused inline file ID must be proven by a saved readable outer message. The controller's system avatar preview comes directly from the profile API and does not relax this agent restriction. Ordinary messaging/widget media retain their existing file-ID rules. Inline rich media require already uploaded IDs. Never use Telegram token-bearing file URLs. If clarification requires a private message, explain it in a result's title/description; the user returns to inline by starting a new query themselves.

Definitions expire 30 days after first registration; confirmed snapshots retain 30 days from last confirmed edit. Ownership is retained for recent edits/callbacks and live widget views. Ordinary history expiry does not remove an active widget view. See [storage](storage.md) and [agent contract](agent-contract.md).
