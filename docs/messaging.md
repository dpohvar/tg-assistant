# Sending, editing and interactive messages

Agents publish through controller tools; their final Codex text is internal. The tool schemas in [agent-contract.md](agent-contract.md) define accepted top-level fields. Nested Telegram objects use native field names. A connected public chat is readable, but another enabled chat agent owns publication in its chat: use `agent_message` to delegate. Direct cross-chat writes are available only to connected passive supergroups/channels; deletion is limited to the current chat. Telegram bot permissions remain necessary. See [security.md](security.md) and [channels-and-discussions.md](channels-and-discussions.md).

## Send a message

For [hidden correspondence](ephemeral.md), prefer `edit({...event.preparedReply,text:"..."})` to complete the private response prepared for `/say`. Ephemeral `read`/`edit`/`delete` use `ephemeralMessageId` and, for outgoing responses, `receiverUserId`. A fresh private `send` uses `ephemeral_message_parameters:{receiver_user_id}` or `reply_parameters:{ephemeral_message_id}` with an inferred known recipient. It returns `{ephemeralMessageId,receiverUserId}`, never ordinary `messageIds:[0]`. These routes are current-chat/agent scoped and cannot mix ordinary, inline or guest addresses. Telegram enforces deadlines and permissions; no automatic public fallback occurs. Private content and recovery limits are documented in the linked article.

For an explicit [guest invocation](guest-mode.md), use `send({guestRequestId,...content})` rather than an ordinary chat destination. It returns `{inlineMessageId}`, supports content/options representable by one native inline result, and cannot upload local files. Guest validation never falls back to a private send. Ordinary calls retain the defaults and results below.

`send` requires exactly one content field. The controller maps it to the corresponding Telegram method:

| Content field | Telegram method | Shape |
| --- | --- | --- |
| `text` | `sendMessage` | String; optional `entities` or `parse_mode` |
| `rich_message` | `sendRichMessage` | Native rich input, normally an object with `blocks`, `html` or `markdown` |
| `photo`, `video`, `document`, `animation`, `audio`, `voice`, `sticker`, `video_note` | Matching `sendPhoto`, `sendVideo`, `sendDocument`, `sendAnimation`, `sendAudio`, `sendVoice`, `sendSticker`, `sendVideoNote` | URL, reusable Telegram file ID or `attach://name` string |
| `media` | `sendMediaGroup` | Array of native InputMedia objects |
| `location`, `venue`, `contact`, `poll`, `dice` | Matching native send method | Object whose fields are flattened into Telegram request |

Other declared fields include caption formatting, reply parameters, inline keyboard, local callback permits, notification/content-protection flags, `message_effect_id` and file declarations. Audio sends accept `title` and `performer`; provide a nonempty title when uploading an audio buffer for cached inline reuse (see [inline mode](inline.md)). The schema intentionally does not expose every native send option. `send` returns `{messageIds:[...]}` for a single message or album; saved returned messages can then be inspected with `read`.

```javascript
await send({text: "Hello", reply_parameters: {message_id: 81}});
await send({text: "Bold", entities: [{type: "bold", offset: 0, length: 4}]});
await send({text: "<b>Bold</b>", parse_mode: "HTML", disable_notification: true});
await send({location: {latitude: 34.7, longitude: 33.1}});
await send({venue: {latitude: 34.7, longitude: 33.1, title: "Cafe", address: "Main Street"}});
await send({contact: {phone_number: "+123456789", first_name: "Alex"}});
await send({poll: {question: "Choose", options: [{text: "A"}, {text: "B"}], is_anonymous: false}});
await send({dice: {emoji: "🎲"}});
```

The names in JavaScript examples stand for tools discovered in `ALL_TOOLS`; use their actual normalized names in the running agent. Do not guess a namespace. `reply_parameters.chat_id`, when supplied, must also be readable. A reply's source message can still be unavailable to Telegram; controller access is not a delivery guarantee.

## Uploads, file IDs and reuse

An attachment declaration maps an `attach://` name to a permitted path under the bot root or the current agent's temp:

```javascript
await send({
  photo: "attach://pic",
  caption: "Preview",
  uploads: {pic: "wiki/images/preview.png"}
});
await send({
  media: [
    {type: "photo", media: "attach://a", caption: "First"},
    {type: "photo", media: "attach://b", caption: "Second"}
  ],
  uploads: {a: "wiki/images/a.png", b: "wiki/images/b.png"}
});
```

The controller reads these local paths and creates multipart uploads. It rejects paths outside the permitted area, hidden components, symlinks and other agents' temp. Albums cannot include `reply_markup` or `permits`; send a separate button message. Media entries use native InputMedia `{type,media,...}`, not bare strings or invented `image`, `source` or `url` blocks.

Reuse known native `file_id` values directly instead of uploading the same bytes. IDs may come from messages, sticker sets or another bot-token-accessible source:

```javascript
await send({
  document: "KNOWN_FILE_ID",
  caption: "The same report"
});
await send({
  rich_message: {blocks: [
    {type: "photo", photo: {type: "photo", media: "KNOWN_PHOTO_ID"}, caption: {text: "Reused image"}}
  ]}
});
```

No upload or saved source proof is required. `file_sources` is accepted and ignored for compatibility. Telegram decides whether the current bot can use the file. `file_unique_id` is not a reusable send ID. Publication still requires write access to the destination chat.

HTTP(S) media URLs are allowed as references, but token-bearing Telegram API/file URLs are rejected. `attach://name` requires a matching declaration. Telegram validates media availability and shape.

`download({fileIds:[...]})` downloads IDs accessible with this bot's token without requiring message proof. Results contain a permitted local `path` or per-file `file_unavailable`. Downloads are cached in own temp by ID hash. Keep private files and IDs confidential. A downloaded file can be uploaded through `attach://`, subject to the authorization for the publication itself.

## Sticker sets and custom emoji

Use `sticker_set_get({name:"https://t.me/addemoji/EXAMPLE"})` to inspect a set's live metadata. Each returned Sticker has `file_id`; emoji members also have `custom_emoji_id`. Use `download` or `download_custom_emoji` for selected members when their artwork or motion matters. Reading a set does not automatically download it or add it to the local catalog. Descriptions can be kept in agent files.

Create a regular sticker set from a permitted PNG file (replace the suffix with the current bot username):

```javascript
await sticker_set_create({
  name: "Faces_by_example_bot",
  title: "Faces",
  type: "regular",
  stickers: [{sticker: "attach://face", format: "static", emoji_list: ["🙂"]}],
  uploads: {face: "wiki/stickers/face.png"}
});
const result = await sticker_set_get({name: "Faces_by_example_bot"});
await send({sticker: result.set.stickers[0].file_id});
```

Static means a single image; both PNG and WebP can be uploaded to a set. Regular static stickers need one side exactly 512px and the other at most 512px; static custom emoji need exactly 100×100px. For custom emoji choose `type:"custom_emoji"`; `ownerUserId` can create the set for a particular user, otherwise the registered bot owner is used. TGS animations use `format:"animated"`; VP9 WebM uses `format:"video"`. Telegram enforces the full [sticker requirements](https://core.telegram.org/stickers). Direct `send({sticker:...})` local file uploads follow sendSticker's WebP/TGS/WebM contract, so use the returned file ID to send a PNG-backed set member.

Send a custom emoji in ordinary text with a native entity, or in a rich button using RichText:

```javascript
await send({text: "🙂", entities: [
  {type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "CUSTOM_EMOJI_ID"}
]});
await send({rich_message: {blocks: [{type: "buttons", buttons: [{
  text: [{type: "custom_emoji", custom_emoji_id: "CUSTOM_EMOJI_ID", alternative_text: "🙂"}, " Choose"],
  callback_data: "choose"
}]}]}});
```

Entity offsets/lengths use UTF-16 code units; keep IDs as strings. Telegram's [custom emoji permission rules](https://core.telegram.org/bots/api#formatting-options) apply: the bot needs an additional Fragment username, or its BotFather owner must have Premium for messages directly sent to private/group/supergroup chats. The application's registered bot owner may be a different user. The controller passes custom emoji through and Telegram determines availability.

Use `sticker_sets({})` for the controller's durable per-bot catalog, and `sticker_set_edit` / `sticker_set_delete` for changes. The [full contract](agent-contract.md#sticker-sets-and-custom-emoji-sets) lists each operation, owner defaults, thumbnail reset and recovery behavior. External sets are usable by name/link without local registration; Telegram checks which sets this bot may edit.

Native generated images must first be registered by the Codex image-generation event, then copied with `save_image({savedPath,dir?})`. Generate and save sequentially in one JavaScript block; print only the saved path. Default destination is `.temp/<agentId>/upload`; use a `wiki/...` directory for durable assets. Temp expires after 24 hours. See [storage.md](storage.md).

## Rich messages

Call `rich_help` for the implemented native examples before unfamiliar layouts. It returns the runtime guide from [`src/messages/rich-help.mjs`](../src/messages/rich-help.mjs), including examples checked in that guide on 2026-10-08. The controller passes rich input through; its help examples are not a full local rich-schema validator, and server acceptance depends on Telegram.

Pass a native object with exactly one content representation: `blocks`, `html` or `markdown`. Do not place `parse_mode` inside blocks. RichText can be a plain string, an array of RichText values, or a typed formatting object; nesting combines formatting.

```javascript
await send({rich_message: {blocks: [
  {type: "heading", size: 2, text: "Report"},
  {type: "paragraph", text: ["Status: ", {type: "bold", text: "ready"}]},
  {type: "photo", photo: {type: "photo", media: "attach://pic"}, caption: {text: "Preview", credit: "Team"}},
  {type: "details", summary: "Shopping list", blocks: [
    {type: "list", items: [
      {blocks: [{type: "paragraph", text: "Bread"}]},
      {blocks: [{type: "paragraph", text: "Milk"}]},
      {blocks: [{type: "paragraph", text: "Done"}], has_checkbox: true, is_checked: true}
    ]}
  ]}
]}, uploads: {pic: "wiki/images/preview.png"}});
```

List `items` are objects with `blocks`, never strings. Ordered items use `value` and `type` (`1`, `a`, `A`, `i`, `I`); unordered items omit both. Do not mix ordered and unordered items within one list. Checkbox list items are presentation, separate from callbacks and native checklist tasks. `details` has `summary` and `blocks`, with optional `is_open:true`; omission starts collapsed.

Persistent block examples in `rich_help` cover:

- Text/layout: `paragraph`, `heading` (`size`), `pre` (`language`), `footer`, `divider`, `mathematical_expression` (`expression`), `anchor` (`name`).
- Structured content: `list`, `blockquote` (`blocks`, optional `credit`), `expandable_blockquote` (`text`, optional `credit`), `pullquote` (`text`, optional `credit`), `details`.
- Media: `photo`, `video`, `animation`, `audio`, `document`, `voice_note`; each uses a matching native InputMedia object. Media captions belong to the **outer block** as `{text,credit?}`; InputMedia captions are ignored in rich blocks.
- Collections: `collage` and `slideshow` use `blocks` and optional caption objects.
- `table`: a matrix of `cells` with RichText `text`, `is_header`, `align`, `valign`; optional `is_bordered`, `is_striped`, `is_compact`. Its `caption` is RichText, not a caption object.
- `map`: `location:{latitude,longitude}`, zoom 0–24, dimensions with width+height at most 10,000 and aspect ratio at most 20, optional caption.
- `buttons`: 1–8 buttons per row, optional `align`; each button has one action.

```javascript
await send({rich_message: {blocks: [
  {type: "table", cells: [
    [{text: "Name", is_header: true, align: "left", valign: "top"}, {text: "Value", is_header: true, align: "right", valign: "top"}],
    [{text: "A", align: "left", valign: "top"}, {text: "1", align: "right", valign: "top"}]
  ], is_bordered: true, is_striped: true, is_compact: true, caption: "Results"},
  {type: "blockquote", blocks: [{type: "paragraph", text: "A quotation"}], credit: "Author"},
  {type: "pre", text: "const n = 1;", language: "javascript"}
]}});
await send({rich_message: {markdown: "# Title\n\n**Bold** and _italic_ text.\n\n- First\n- Second"}});
await send({rich_message: {html: "<details><summary>Shopping list</summary><ul><li>Bread</li><li>Milk</li></ul></details>"}});
await send({rich_message: {
  html: '<p>Before</p><img src="tg://photo?id=pic"/><p>After</p>',
  media: [{id: "pic", media: {type: "photo", media: "attach://pic"}}]
}, uploads: {pic: "wiki/images/preview.png"}});
```

The runtime guide's RichText types include `bold`, `italic`, `underline`, `strikethrough`, `spoiler`, `subscript`, `superscript`, `marked`, `code`; `date_time` with `unix_time`/`date_time_format`; `text_mention` with native `user`; `custom_emoji` with `custom_emoji_id`/`alternative_text`; `mathematical_expression`; URL/email/phone/bank-card/mention/hashtag/cashtag/bot-command link forms; inline `button`; `anchor`, `anchor_link`, `reference` and `reference_link`. Use `rich_help.richText` for exact typed examples rather than inventing fields.

Thinking blocks, `sendRichMessageDraft` and streaming drafts are not exposed. [Inline queries](inline.md) use a separate result/action protocol. The archived rich-message gallery is historical supplementary material; the current runtime guide and tool schemas define this project's contract.

## Editing

`edit` requires a saved original. Native type conversions are attempted in place and accepted or rejected by Telegram; the controller never replaces the message automatically. Supplied components replace their complete component; it is not a patch to a nested rich document. Omit a component to leave it unchanged. For a rich replacement, read first, preserve needed media as InputMedia file IDs, and supply the full replacement rich content.

```javascript
await edit({messageId: 110, text: "Updated text", entities: [{type: "bold", offset: 0, length: 7}]});
await edit({messageId: 111, caption: "Updated caption"});
await edit({messageId: 111, media: {
  type: "photo", media: "attach://new", caption: "New image", parse_mode: "HTML"
}, uploads: {new: "wiki/images/new.png"}});
await edit({messageId: 110, reply_markup: {inline_keyboard: []}});
await edit({messageId: 110, permits: {"*": []}});
```

Text/rich replacements call `editMessageText`; caption-only updates call `editMessageCaption`; media replacements call `editMessageMedia`; keyboard updates call `editMessageReplyMarkup`. If replacing media, place caption and formatting **inside `media`**, not alongside it. An omitted replacement caption preserves the old caption and, when appropriate, its entities; explicit `caption:""` clears it. Declared direct media fields are photo/video/document/audio/animation. The replacement may change type when Telegram permits it.

Omitted permits are retained. A permits-only edit updates local state without Telegram and returns `{messageId,updated:["permits"]}`. Removing all allowed participants with `{"*":[]}` does not visibly disable the keyboard; use a disabled button/keyboard replacement when needed. Permits supplied alongside a caption/media-only edit are not persisted by those components; use a permits-only edit or include a rich/keyboard update.

Edits execute components separately. Results list `updated`, optional `failed` and optional `unknown`; partial results include `error:"edit_failed"`. Retry only known failed components. Inspect unknown outcomes first. `storage_failed` after confirmed edits lists confirmed `updated` components; repeating them can cause duplicate or stale effects.

## Copying and forwarding

```javascript
await copy({fromChatId: -100123, messageIds: [81], caption: "Copied report", reply_parameters: {message_id: 90}});
await forward({fromChatId: -100123, messageIds: [81, 82], disable_notification: true});
await copy({fromChatId: -100123, messageIds: [81, 82], remove_caption: true});
```

Both validate readable source and writable destination, defaulting each to current chat. `messageIds` must be nonempty, safe integers in strictly increasing order. A single ID uses the singular Telegram method; multiple IDs use the batch method. Telegram can skip uncopyable/unforwardable messages in a batch; returned IDs do not prove a one-to-one mapping to all requested IDs.

Single `copy` supports reply parameters, markup, permits, replacement caption/entities/parse mode and caption placement. Single copy rejects `remove_caption`; use `caption:""` to clear its caption. Batch copy supports `remove_caption` but rejects reply parameters, markup, permits, caption/formatting and caption placement. `forward` rejects reply parameters, markup and permits even though the shared schema declares those fields. Both expose notification/protection flags; Telegram determines whether each is valid for that method.

A single forward saves Telegram's returned message. A single copy returns only Telegram's new message ID, so the controller reconstructs a record from a saved source when available and marks `reconstructed:true`. It copies known content but not old forwarding provenance, old reply provenance, old album ID or old keyboard. Requested new reply/keyboard/protection are reconstructed where possible. A caption supplied with `parse_mode` has a `reconstructionNotes` warning because the controller cannot reconstruct Telegram entities. A copy with no saved source, and batch transfers, need not produce full saved destination records; later `read`/`edit` may be unavailable. Button permits for a single copy are saved as part of successful reconstruction.

## Buttons, callback groups and permits

Buttons can live in native `reply_markup.inline_keyboard` or rich `buttons` blocks. Each has exactly one action: for example `callback_data`, `url`, `copy_text`, `disabled`, `web_app` or `login_url`. Styles in the runtime guide are `primary`, `success`, `danger`; link style is only for callbacks. A disabled button uses `disabled:{}` with no `callback_data`.

```javascript
await send({text: "Choose a result", reply_markup: {inline_keyboard: [[
  {text: "⬜️ Yes", callback_data: "[choice]yes", style: "success"},
  {text: "⬜️ No", callback_data: "[choice]no", style: "danger"}
]]}, permits: {"[choice]*": [123], "help": null}});
await send({rich_message: {blocks: [{type: "buttons", align: "left", buttons: [
  {text: "Website", url: "https://example.com"},
  {text: "Copy", copy_text: {text: "Hello"}},
  {text: "Unavailable", disabled: {}}
]}]}});
```

Callback data is either a plain key or `[group]key`. Key and group must be nonempty, at most twenty Unicode code points each; the complete callback is at most 64 UTF-8 bytes. Brackets are reserved for that syntax. A plain key is repeatable; the first accepted grouped callback closes every callback button of that group in the saved message. It removes their callback data, adds `disabled:{}`, changes a leading checkbox icon on the chosen button to `✅` and on other group buttons to `⬛️`. Buttons without such an icon retain their text. `⬜️` is the unchecked convention. Groups remain closed even if Telegram's visible edit fails; editing permits does not reopen them.

In public groups, `permits` maps callback data patterns to participant IDs or `null`:

- Omitted/null stored permits allow all participants.
- An exact callback-data key wins over wildcard patterns.
- Patterns ending in `*` match prefixes; the longest matching prefix wins. `"*"` is the fallback for all callbacks.
- A `null` rule allows everyone; an array allows only included user IDs; `[]` denies everyone. No matching rule denies access.

Permits are local controller state, not native Telegram access control. They are enforced for nonprivate callbacks; private callbacks instead require an authorized private user. Channels reject callback handling. A callback also needs a saved matching enabled button, an enabled agent and available queue capacity. The controller acknowledges it itself; there is no agent `answerCallbackQuery` tool. Accepted callbacks produce `button` events described in [message-events.md](message-events.md).

## Delivery and recovery

| Result/error | Meaning and next step |
| --- | --- |
| `{messageIds}` / successful edit components | Telegram confirmed the action and normal local persistence completed. |
| `invalid_argument` | Invalid content combination/type or unsupported transfer option; correct the request. |
| `file_not_accessible` | Media reference uses a secret-bearing Telegram URL or lacks a declared upload; correct the reference. |
| `message_not_found` | Edit lacks saved original; do not guess its type. |
| `telegram_api_error` | Telegram rejected the request; sanitized API description (up to 1,000 characters) identifies the issue. |
| `telegram_failed` / other Telegram error code | Request rejected/failed; inspect fields and permissions before retrying. |
| `delivery_unknown` | Transport did not return confirmation; action may have completed. Do not automatically repeat. |
| `storage_failed` with IDs or `updated` | Telegram action succeeded but local save/reconstruction failed. Do not resend confirmed effects. |
| `edit_failed` with `failed`/`unknown` | Some separate edit components failed or lack confirmation; inspect unknowns, retry only known failures. |

Action tools `delete`, `pin`, `unpin`, `react` return `{status:"done"}` on success. Reaction entries are native `{type,emoji? ,custom_emoji_id?}`. Received reaction updates update saved records without starting an agent turn. Controller authorization and stale-scope failures can also return the generic error envelope described in [agent-contract.md](agent-contract.md).

## Implementation references

Current behavior is in [`src/messages/actions.mjs`](../src/messages/actions.mjs), [`src/messages/callbacks.mjs`](../src/messages/callbacks.mjs), [`src/messages/rich-help.mjs`](../src/messages/rich-help.mjs), [`src/files/download.mjs`](../src/files/download.mjs) and [`src/controller.mjs`](../src/controller.mjs). Focused tests cover `message-actions`, `upload-reply`, `buttons`, `button-disabled`, `rich-help`, `profile-download` and `reactions` under [`test/integration`](../test/integration). Administrative bot management is separate in [master-bot.md](master-bot.md).

## Forum destinations

`send`, `copy` and `forward` accept positive integer `topicId` for the destination, including albums and rich messages. General is 1 and uses native parameter omission. A reply without an explicit topic can inherit its source topic; explicit General rejects a different or unknown reply topic. No automatic fallback or retry occurs. See [forum groups](forum-groups.md) for examples, cross-topic replies and history behavior.

## Programmable widgets

Use [widget tools](widgets.md) when buttons or events should run code independently of model activity. Widget `render(state,view)` declares the full representation for each of zero or more views. Widget callbacks use an exported action name or `action:payload`; exact `void` acknowledges a decorative button without executing a handler. Only complete current button strings are accepted, without ordinary one-use groups/permits. See the [widget callback contract](widgets.md#state-callbacks-and-observations) for payloads, reserved names and examples. Ordinary `edit` is blocked on any registered widget view, including stopped widgets. Ordinary addressing also rejects all via_bot edits; use the separately owned inline address where available. Native dice/poll/other creation-only content may retain its keyboard as the editable component. Widget live locations support location edits and explicit stop; albums are not a single widget.
