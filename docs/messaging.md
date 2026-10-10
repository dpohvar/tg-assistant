# Sending, editing and interactive messages

Agents publish through controller tools; their final Codex text is internal. The tool schemas in [agent-contract.md](agent-contract.md) define accepted top-level fields. Nested Telegram objects use native field names. A connected public chat is readable, but another enabled chat agent owns publication in its chat: use `agent_message` to delegate. Direct cross-chat writes are available only to connected passive supergroups/channels; deletion is limited to the current chat. Telegram bot permissions remain necessary. See [security.md](security.md) and [channels-and-discussions.md](channels-and-discussions.md).

## Send a message

`send` requires exactly one content field. The controller maps it to the corresponding Telegram method:

| Content field | Telegram method | Shape |
| --- | --- | --- |
| `text` | `sendMessage` | String; optional `entities` or `parse_mode` |
| `rich_message` | `sendRichMessage` | Native rich input, normally an object with `blocks`, `html` or `markdown` |
| `photo`, `video`, `document`, `animation`, `audio`, `voice`, `sticker`, `video_note` | Matching `sendPhoto`, `sendVideo`, `sendDocument`, `sendAnimation`, `sendAudio`, `sendVoice`, `sendSticker`, `sendVideoNote` | URL, proved Telegram file ID or `attach://name` string |
| `media` | `sendMediaGroup` | Array of native InputMedia objects |
| `location`, `venue`, `contact`, `poll`, `dice` | Matching native send method | Object whose fields are flattened into Telegram request |

Other declared fields include caption formatting, reply parameters, inline keyboard, local callback permits, notification/content-protection flags and file declarations. The schema intentionally does not expose every native send option. `send` returns `{messageIds:[...]}` for a single message or album; saved returned messages can then be inspected with `read`.

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

Prefer reusing recently sent files rather than uploading the same bytes. Read a saved **outer message**, extract its native `file_id`, use the ID as the media reference and declare its provenance:

```javascript
await send({
  document: "KNOWN_FILE_ID",
  caption: "The same report",
  file_sources: [{messageId: 105, fileId: "KNOWN_FILE_ID"}]
});
await send({
  rich_message: {blocks: [
    {type: "photo", photo: {type: "photo", media: "KNOWN_PHOTO_ID"}, caption: {text: "Reused image"}}
  ]},
  file_sources: [{chatId: -100123, messageId: 106, fileId: "KNOWN_PHOTO_ID"}]
});
```

No upload is needed for reuse. Every checked Telegram file ID must be found recursively inside an accessible saved source message; the outer record can contain the file in `reply_to_message`. A naked ID, a mismatching ID, an expired/deleted outer record or an inaccessible source produces `file_not_accessible`. Supply `chatId` only when the source is another readable chat. `file_unique_id` is not a reusable send ID.

HTTP(S) media URLs are allowed as references, but token-bearing Telegram API/file URLs are rejected. `attach://name` requires a matching declaration. The current provenance walker recognizes ordinary media fields, album InputMedia and rich photo/video/audio/document/animation fields; do not rely on it as complete semantic validation of every nested native rich field. Telegram still validates media availability and shape.

`download({fileIds:[...]})` has a different contract: it downloads IDs accessible with this bot's token without requiring `file_sources` or message proof. Results contain a permitted local `path` or per-file `file_unavailable`. Downloads are cached in own temp by ID hash. Keep private files and IDs confidential. A downloaded file can be uploaded through `attach://`, subject to the authorization for the publication itself.

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

Thinking blocks, `sendRichMessageDraft`, streaming drafts and inline-query handling are not exposed. Do not promise inline-query buttons work. The archived rich-message gallery is historical supplementary material; the current runtime guide and tool schemas define this project's contract.

## Editing

`edit` requires a saved original and preserves its detected content type. Supplied components replace their complete component; it is not a patch to a nested rich document. Omit a component to leave it unchanged. For a rich replacement, read first, preserve needed media as InputMedia file IDs with `file_sources`, and supply the full replacement rich content.

```javascript
await edit({messageId: 110, text: "Updated text", entities: [{type: "bold", offset: 0, length: 7}]});
await edit({messageId: 111, caption: "Updated caption"});
await edit({messageId: 111, media: {
  type: "photo", media: "attach://new", caption: "New image", parse_mode: "HTML"
}, uploads: {new: "wiki/images/new.png"}});
await edit({messageId: 110, reply_markup: {inline_keyboard: []}});
await edit({messageId: 110, permits: {"*": []}});
```

Text/rich replacements call `editMessageText`; caption-only updates call `editMessageCaption`; media replacements call `editMessageMedia`; keyboard updates call `editMessageReplyMarkup`. If replacing media, place caption and formatting **inside `media`**, not alongside it. An omitted replacement caption preserves the old caption and, when appropriate, its entities; explicit `caption:""` clears it. Declared direct media fields are photo/video/document/audio/animation. Original type must match the replacement.

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
| `file_not_accessible` | Media reference lacks accessible saved provenance or declared upload; correct source declarations. |
| `message_not_found` | Edit lacks saved original; do not guess its type. |
| `telegram_api_error` | Telegram rejected the request; sanitized API description (up to 1,000 characters) identifies the issue. |
| `telegram_failed` / other Telegram error code | Request rejected/failed; inspect fields and permissions before retrying. |
| `delivery_unknown` | Transport did not return confirmation; action may have completed. Do not automatically repeat. |
| `storage_failed` with IDs or `updated` | Telegram action succeeded but local save/reconstruction failed. Do not resend confirmed effects. |
| `edit_failed` with `failed`/`unknown` | Some separate edit components failed or lack confirmation; inspect unknowns, retry only known failures. |

Action tools `delete`, `pin`, `unpin`, `react` return `{status:"done"}` on success. Reaction entries are native `{type,emoji? ,custom_emoji_id?}`. Received reaction updates update saved records without starting an agent turn. Controller authorization and stale-scope failures can also return the generic error envelope described in [agent-contract.md](agent-contract.md).

## Implementation references

Current behavior is in [`src/messages/actions.mjs`](../src/messages/actions.mjs), [`src/messages/callbacks.mjs`](../src/messages/callbacks.mjs), [`src/messages/rich-help.mjs`](../src/messages/rich-help.mjs), [`src/files/download.mjs`](../src/files/download.mjs) and [`src/controller.mjs`](../src/controller.mjs). Focused tests cover `message-actions`, `upload-reply`, `buttons`, `button-disabled`, `rich-help`, `profile-download` and `reactions` under [`test/integration`](../test/integration). Administrative bot management is separate in [master-bot.md](master-bot.md).
