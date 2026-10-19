# Agent tool contract

Hidden [ephemeral correspondence](ephemeral.md) adds explicit alternatives to the ordinary tool tables: `read({ephemeralMessageId,receiverUserId?,chatId?})`, `edit({ephemeralMessageId,receiverUserId,...content})`, and `delete({ephemeralMessageId,receiverUserId})`. Incoming reads omit the receiver; outgoing bot-response tools require it. Addresses belong to this agent in the current chat and cannot mix ordinary, inline or guest selectors. Private `send` accepts `ephemeral_message_parameters:{receiver_user_id}` or `reply_parameters:{ephemeral_message_id}` with an inferred recipient, returning `{ephemeralMessageId,receiverUserId}`. Private edit returns that address and `updated`; private delete returns it and `status:"deleted"`. Native ID zero is never an ordinary address. Unsupported private content and recovery rules are documented in the linked article.

The controller supplies the dynamic tools below to each chat's Codex thread and its owned child threads. These are controller tools, separate from native Codex tools and configured [MCP servers](mcp.md). Incoming controller events are described in [message-events.md](message-events.md); sending and editing examples are in [messaging.md](messaging.md).

Publish user-facing output through `send`. A Codex final answer is internal and is not delivered to Telegram or to another agent. Inspect every tool result: completing a turn does not establish that an external action succeeded. Tool results are JSON text in the app-server `contentItems`; code-mode callers may need to parse a string before inspecting its fields. The RPC reply sets `success` to false when the result has an `error` property. Thrown controller exceptions become `{error: code || "tool_failed", description}` with a description limited to 1,000 characters.

All top-level argument objects reject additional properties. Required fields are marked with `!` below; omitted `chatId` defaults to the agent's current chat. Types use `string`, `integer`, `boolean`, `object` and `array`. Nested Telegram objects are passed through rather than exhaustively modeled by this controller. Do not assume an arbitrary Telegram Bot API parameter is accepted at the top level.

## Scope and execution

Tools are fenced by the bot and current agent lifecycle. Removed authorization, deletion, stopping or a replaced session can reject a call. Read access covers the current private chat and connected public chats of the same bot; another private chat is inaccessible. Write access covers the current chat and another connected **supergroup or channel** without an enabled agent. To publish in another active chat, delegate through `agent_message`. Foreign ordinary groups are not writable through these tools. See [security.md](security.md) and [channels-and-discussions.md](channels-and-discussions.md).

Common scope errors are `invalid_argument`, `chat_not_accessible`, `chat_not_writable` and lifecycle failures reported as `tool_failed`. Telegram permission requirements still apply after controller access checks.

## Message tools

| Tool | Arguments | Result and constraints |
| --- | --- | --- |
| `send` | Exactly one of `text:string`, `rich_message:string\|object`, `media:array`, `photo`, `video`, `document`, `audio`, `voice`, `animation`, `sticker`, `video_note` (all strings), `location`, `venue`, `contact`, `poll`, `dice` (objects). Optional `chatId:integer`, `topicId:integer`, `title:string`, `performer:string` (audio), `caption:string`, `parse_mode:string`, `entities:array`, `caption_entities:array`, `show_caption_above_media:boolean`, `disable_notification:boolean`, `protect_content:boolean`, `message_effect_id:string`, `reply_parameters:object`, `reply_markup:object`, `permits:object`, `uploads:object`, `file_sources:array`. | `{messageIds:[integer]}`. Albums reject buttons and permits. See [messaging.md](messaging.md) for content objects and recovery errors. |
| `rich_help` | None | A fresh guide object with `source`, `checked`, `rules`, `blocks`, `orderedList`, `detailsWithList`, `markdownExample`, `htmlExample`, `htmlMedia`, `richText`, `unsupported`. Consult it before unfamiliar rich layouts. |
| `edit` | Ordinary address: `messageId:integer!`, optional `chatId:integer`; alternatively `inlineMessageId:string!` alone. Optional `text:string`, `rich_message:string\|object`, `photo`, `video`, `document`, `audio`, `animation` (strings), `media:object`, `caption:string`, `entities:array`, `caption_entities:array`, `parse_mode:string`, `reply_markup:object`, `permits:object`, `uploads:object`, `file_sources:array`. | Ordinary: `{messageId,updated:[component],failed?:[component],unknown?:[component],error?,description?}`. Attempts native conversions in place and requires a saved original; Telegram determines admissibility. A permits-only ordinary edit is local. Omitted ordinary permits are retained. Inline edits have a separate ownership, button, snapshot and upload contract described below. |
| `copy` | `messageIds:array<integer>!`; optional `chatId:integer`, `topicId:integer`, `fromChatId:integer`, `reply_parameters:object`, `reply_markup:object`, `permits:object`, `disable_notification:boolean`, `protect_content:boolean`, `remove_caption:boolean`, `caption:string`, `caption_entities:array`, `parse_mode:string`, `show_caption_above_media:boolean`. | `{messageIds}`. IDs must increase strictly. Single-copy and batch-copy support different options; see [messaging.md](messaging.md). |
| `forward` | `messageIds:array<integer>!`; optional `chatId:integer`, `topicId:integer`, `fromChatId:integer`, `reply_parameters:object`, `reply_markup:object`, `permits:object`, `disable_notification:boolean`, `protect_content:boolean`. | `{messageIds}`. Although declared in the schema, reply parameters, markup and permits are rejected for forwards. |
| `delete` | `messageId:integer!`; optional `chatId:integer`, `reaction:array` | `{status:"done"}`. Only the current chat may be deleted from; also deletes its saved history record. |
| `pin` | `messageId:integer!`; optional `chatId:integer`, `reaction:array` | `{status:"done"}`. Calls `pinChatMessage`. |
| `unpin` | Optional `messageId:integer`, `chatId:integer`, `reaction:array` | `{status:"done"}`. Calls `unpinChatMessage`; an omitted message ID follows Telegram's unpin behavior. |
| `react` | `messageId:integer!`; optional `chatId:integer`, `reaction:array` | `{status:"done"}`. Calls `setMessageReaction` and records the result locally. Use an empty array to clear a reaction. |

`reaction` entries have required `type:string` and optional `emoji:string`, `custom_emoji_id:string`, with no extra keys. Only `react` uses this field even though the shared schemas declare it for all four action tools. Telegram rejections for these action tools are caught by the outer RPC wrapper, unlike the detailed `send`/`edit` recovery results.

`file_sources` is accepted and ignored for compatibility; it is not required for Telegram file IDs. Its entries retain the schema `{messageId:integer!,fileId:string!,chatId?:integer}`. `uploads` maps attachment names to permitted local paths. Album entries and edit `media` are InputMedia objects with required `type:string` and `media:string`; optional `caption:string`, `caption_entities:array`, `parse_mode:string`, plus native extra fields. Entity entries require `type:string`, `offset:integer`, `length:integer` and allow native extra fields.

## Sticker sets and custom emoji sets

All model agents receive these tools. Telegram determines whether this bot can manage a set; no extra controller role check or local-catalog prerequisite applies. Sets belong to a Telegram user, while the creating bot can manage them. The default owner is the application's registered bot owner. Developer instructions can impose additional policy.

| Tool | Arguments | Result and constraints |
| --- | --- | --- |
| `sticker_set_get` | `name:string!` | `{set:nativeStickerSet,link}`. Accepts a short name or HTTPS `t.me/addstickers/NAME` / `t.me/addemoji/NAME` link. Live full metadata, including each member's `file_id` and optional `custom_emoji_id`; no automatic downloads or registration of external sets. |
| `sticker_sets` | None | `{sets:[{name,title,type,ownerUserId,link}],uncertain?:[sameFields]}`. Bot-wide durable local catalog of sets created through these tools. Confirmed creations are in `sets`; unconfirmed creation intents are separate. No Telegram enumeration/backfill. |
| `sticker_set_create` | `name:string!`, `title:string!`, `type:"regular"\|"custom_emoji"!`, `stickers:array<InputSticker>!`; optional `ownerUserId:integer`, `uploads:object`, `needsRepainting:boolean` | `{status:"created",name,ownerUserId,link}`. Full short name must end `_by_<bot_username>` (case insensitive); title/name at most 64 characters. 1–50 initial stickers. `needsRepainting` only for emoji sets. Call get afterwards for native member IDs. |
| `sticker_set_edit` | `name:string!`, `action:string!`, action fields below | `{status:"done",name}`. One operation; known recorded owner defaults before the bot owner. Explicit `ownerUserId` overrides this for applicable actions. Named-set membership is checked for file-ID-only edits. |
| `sticker_set_delete` | `name:string!` | `{status:"deleted",name}`. Deletes the actual Telegram set and removes its local catalog record after confirmation. |

Edit actions (other action fields are rejected):

| `action` | Fields |
| --- | --- |
| `add` | `sticker:InputSticker!`, optional `ownerUserId`, `uploads` |
| `replace` | `oldFileId:string!`, `sticker:InputSticker!`, optional `ownerUserId`, `uploads` |
| `remove` | `fileId:string!` |
| `move` | `fileId:string!`, `position:integer!` (zero based) |
| `set_emojis` | `fileId:string!`, `emojiList:array<string>!` (1–20) |
| `set_keywords` | `fileId:string!`, `keywords:array<string>!` (0–20, total 64 characters; empty clears) |
| `set_title` | `title:string!` (1–64 characters) |
| `set_thumbnail` (regular) | `thumbnail:string\|null!`, `format:"static"\|"animated"\|"video"!`, optional `ownerUserId`, `uploads`; null resets to first sticker |
| `set_thumbnail` (custom emoji) | `customEmojiId:string\|null!`; ID must belong to the set; null resets to first emoji |

InputSticker is `{sticker:string,format:"static"|"animated"|"video",emoji_list:[string],keywords?:[string]}`. `sticker` accepts a reusable file ID, a Telegram-supported HTTP(S) URL, or `attach://name` with a matching `uploads` entry. Static uploads can be PNG or WebP; animation is TGS and video is WebM. Telegram validates dimensions, encoding, sizes and capacities; animated/video uploads generally require multipart rather than HTTP URLs. Local uploads retain the existing path restrictions. There is no controller renderer or separate upload-sticker tool. See [creation and usage examples](messaging.md#sticker-sets-and-custom-emoji).

Validation failures return `invalid_argument`; unavailable/disallowed local paths return `file_unavailable`. Telegram rejections return `telegram_api_error` with a sanitized description. `delivery_unknown` includes `name`: inspect that set before repeating a mutation. Create intent is persisted before the network call; unknown outcomes remain in `uncertain` across restart. A read does not prove who created a set and does not silently promote uncertainty. Repeated create calls for a recorded name are refused. A confirmed mutation followed by catalog failure returns `storage_failed`, `applied:true`, `name`: do not repeat it. Failure to store an intent returns `storage_failed`, `applied:false` without attempting creation. A rejected creation whose intent cannot be removed also returns `storage_failed`, `applied:false` and retains the uncertain record.

Catalog titles/types are cached; get refreshes confirmed entries and title edits update them. External changes/deletions are not polled. Agent reset/deletion does not remove catalog entries; bot removal removes local entries without deleting Telegram sets. Store descriptions/semantic notes in agent files if useful. Inspect selected members using `download` or `download_custom_emoji` only when needed.

## Saved history and notes

| Tool | Arguments | Result and constraints |
| --- | --- | --- |
| `read` | Ordinary address: `messageIds:array<integer>!`, optional `chatId:integer`; alternatively `inlineMessageId:string!` or `guestRequestId:string!` alone | Ordinary: `{messages:[nativeMessage\|errorEntry]}` in request order. Native `date` and `edit_date` values recursively become ISO strings; saved button `permits` are added when present. Missing entries use `{messageId,error:"message_not_found",description}`. Read the current outer message to inspect its embedded `reply_to_message`. Inline reads return only saved confirmed components, described below. |
| `history` | `messageId:integer\|null!`, `from:integer!`, `to:integer!`; optional `chatId:integer`, `topicId:integer`, `discussion:object` | `{messages:[shortMessage]}` in ascending date/message-ID order. Half-open slice `[anchor+from,anchor+to)`; `null` anchors after the latest saved message. Requires `from <= to`. |
| `search` | Optional `chatId:integer`, `topicId:integer`, `text:array<string>`, `senderId:integer`, `types:array<string>`, `since:string`, `until:string`, `limit:integer`, `cursor:string`, `discussion:object` | `{messages:[shortMessage],nextCursor?:string}` newest first. Default limit 20; positive integer, no controller upper bound. Every literal text substring must match, case-insensitively. `since` inclusive, `until` exclusive; dates require explicit ISO offset. `types` matches any requested native field; `text` includes text or caption. Continue with **cursor alone**. |
| `topics` | Optional `chatId:integer` | `{enabled:boolean,topics:[{topicId,name,closed?,hidden?}]}` ordered by ID; unknown names null, unknown states omitted. Last-observed registry, same history read access. See [forum groups](forum-groups.md). |
| `note_get` | None | `{text:string}`: this chat's persistent note. |
| `note_set` | `text:string!` | `{status:"saved"}`. Replaces the note, at most 4,000 Unicode code points. |

`discussion` is `{chatId:integer!,messageId:integer!}` with no extra keys: the referenced channel post, while the query's `chatId` selects its discussion group. The controller finds the saved automatic forward, follows reply descendants and matching thread IDs, and excludes the automatic-forward root. Both chats must be readable. This is saved history, not Telegram backfill.

History errors include `invalid_argument`, `message_not_found`, `discussion_not_found`, `invalid_cursor`, `cursor_expired`. A search cursor is signed, bound to this bot/agent and expires after one hour. Each search fixes a receipt-sequence boundary; later arrivals are excluded even when their Telegram date is old. Access is rechecked on continuation; expired/deleted records need not remain in the snapshot.

## Agents and Telegram metadata

| Tool | Arguments | Result and constraints |
| --- | --- | --- |
| `agents` | None | `{agents:[{agentId,chatType,name,chatId?}]}` for this bot. Foreign private chat IDs are omitted. |
| `chats` | None | `{chats:[{chatId,chatType,name,agentId?}]}`: connected public chats and own private chat, ordered by chat ID. |
| `agent_info` | `agentIds:array<string>!` | `{agents:[info\|errorEntry]}` in input order. Private entries expose name/username but only the current agent's chat ID. Public entries include current filtered Telegram info. Per-item errors: `agent_not_found`, `chat_unavailable`. |
| `chat_info` | `chatIds:array<integer>!` | `{chats:[nativeFilteredInfo\|errorEntry]}` in input order. Any nonzero safe chat/user ID Telegram permits; inaccessible entries use `chat_unavailable`. Metadata access grants neither history nor write access. Restricted fields require connected/readable chat; accessible public chats may include `memberCount`, `botStatus`. |
| `members` | `userIds:array<integer>!` | `{members:[{userId,name,username?,status,customTitle?,untilDate?}\|errorEntry]}`. Current group/supergroup only. Per-item `member_unavailable`; positive native `until_date` becomes ISO `untilDate`. |
| `user_roles` | `userIds:array<integer>!` | `{users:[{userId,role}]}` in input order, including duplicates. Fresh application roles of this bot: `user`, `manager`, `admin`, `owner`, or `null` for no assigned role. IDs must be positive safe integers; invalid input fails with `invalid_argument`, never `role:null`. No Telegram call, chat membership or previous private contact is required. Empty input returns an empty list. Read-only, with no authorization to access another user's private history. |
| `user_photos` | `userId:integer!`, optional `offset:integer`, `limit:integer` | Native `{total_count,photos}` size variants, no download. Positive user ID, nonnegative offset, limit 1–100 (default 10). Errors `invalid_argument`, `profile_photos_unavailable`. |
| `agent_message` | `agentId:string!`, `text:string!` | `{status:"queued"}`; same bot, enabled and authorized target, at most 8,000 Unicode code points. Otherwise `agent_unavailable` or validation failure. Asynchronous; no automatic reply/acknowledgement. |

An authenticated `agent_message` event is an actionable delegated request, including permission to publish the delegated message in the recipient's own chat. Reply explicitly with `agent_message` to `from.agentId`. It grants no additional roles, tools or filesystem access. Share only information needed for the authorized task, never unrelated private history or notes. Failure can produce an `agent_error` event; see [message-events.md](message-events.md).

Application roles apply across this bot and inherit as `user` → `manager` → `admin` → `owner`; they are separate from Telegram statuses returned by `members`. Roles are not automatically attached to messages or button events. Call `user_roles` only when a decision needs current authorization; do not rely on memory or older results. Check again before a delayed privileged action. Failure to check does not establish authorization. The result is a current snapshot, not a lock or a grant of additional controller permissions.

## Files, readers, time and secrets

| Tool | Arguments | Result and constraints |
| --- | --- | --- |
| `time` | None | `{now:ISO_UTC_string}` from server time. Use for relative scheduling. |
| `download` | `fileIds:array<string>!` | `{files:[{fileId,path}\|{fileId,error:"file_unavailable",description}]}`. Nonempty strings; malformed request gives `invalid_argument`. Uses bot-token Telegram access, **does not require message/source proof**. Cached in own `.temp/<agentId>/download`; keep private identifiers/files confidential. |
| `download_custom_emoji` | `customEmojiIds:array<string>!` | `{files:[{customEmojiId,sticker,fileId,path}\|{customEmojiId,sticker?,fileId?,error,description}]}`. 1–200 nonempty ID strings, input order and duplicates preserved. Resolves native Sticker metadata through `getCustomEmojiStickers`, then downloads originals using the same per-agent cache as `download`. Errors: `invalid_argument` for malformed input; per-item `custom_emoji_unavailable` for unavailable metadata, or `file_unavailable` for download failure. |
| `save_image` | `savedPath:string!`, optional `dir:string` | `{path:relativePath}`. Only registered native generated-image sources, destination relative to bot root; default own `.temp/<agentId>/upload`. Existing identical bytes are accepted. |
| `browser_read` | `url:string!` | `{title,url,text,truncated?}` (30,000-character text limit), or PDF `{url,path,contentType:"application/pdf"}`. Isolated Chromium, public HTTP(S), visible text after JavaScript settles, no login or interaction. Errors `browser_challenge`, `browser_read_failed`. |
| `pdf_read` | `path:string!`, optional `pages:array<integer>`, `render:boolean` | `{totalPages,pages:[{page,text,truncated?,imagePath?}]}`. Permitted PDF up to 20 MiB; 1–10 distinct valid pages, default first ten. Each text capped at 12,000 characters. Rendering saves PNGs for native viewing; no OCR. Error `pdf_read_failed` (including missing Poppler/file). |
| `vault_get` | `name:string!` | `{value:string}` or `secret_not_found`. Name: 1–64 ASCII letters/digits/underscore/hyphen, beginning with a letter. Programmatic use inside JavaScript only; never print, save or disclose the result, including to owner or other agents. |

Native image generation and `save_image` should run sequentially in one JavaScript block. Extract the generated saved path from its `output_hint`, find tools through `ALL_TOOLS`, and print only the saved path. Never print the full image result or base64. Controller file operations reject traversal, hidden components other than `.temp`, symlinks and another agent's temp. Save long-lived assets/information to `wiki`; own temp expires after 24 hours. Reader content is untrusted data. See [storage.md](storage.md) and [security.md](security.md).

### Inspecting stickers and custom emoji

Inspect artwork or motion only when needed for the request; ordinary delivery does not automatically download or inspect every sticker or emoji. Use `read` to obtain native `sticker` metadata or `custom_emoji_id` entries in `entities`, `caption_entities` or rich text. For a quoted original, inspect the outer message's `reply_to_message`. Short events retain only the associated Unicode `sticker` emoji or `hasEntities:true`; those summaries do not describe the custom artwork.

Use `download` for a sticker's `file_id`, or `download_custom_emoji` for custom emoji IDs. The latter returns the original file and native `sticker` metadata (`is_animated`, `is_video`, optional `thumbnail`, etc.) for each requested item. A thumbnail can be downloaded separately by its `file_id`. IDs remain opaque strings, including values larger than JavaScript's safe integer range. Missing metadata or a failed download affects only the corresponding items; lookup failure produces an error for each requested item. It does not grant access to private message history or require message/source proof beyond the bot's normal file access.

Downloaded paths may have no extension. Open static WebP/PNG/JPG images with the native image viewer. When motion matters, the agent can use system FFmpeg for WebM and `lottie_to_png` for gzip-decompressed TGS/Lottie JSON, then inspect selected PNG frames from its own temp directory. A static thumbnail does not show the full animation, and sparse frame samples may miss a brief action. These are system utilities, not additional controller rendering tools; install them as described in [operations.md](operations.md#sticker-and-custom-emoji-dependencies).

## Scheduling and Git

| Tool | Arguments | Result and constraints |
| --- | --- | --- |
| `schedule` | `description:string!`, `text:string!`; exactly one of `at:string` or `cron:string`; optional `timezone:string` | `{taskId:string}`. Nonempty description up to 100 Unicode code points; nonempty self-contained instruction. `at` requires explicit ISO offset; cron is five-field with IANA timezone. See [scheduler.md](scheduler.md). |
| `tasks` | Optional `taskIds:array<string>` | `{tasks:[{taskId,description,at,cron,timezone,createdAt,text?}]}` belonging to this chat's agent. Full `text` only when `taskIds` is supplied; unknown IDs are omitted. |
| `cancel_tasks` | `taskIds:array<string>!` | `{status:"cancelled"}`. Cancels only this agent's tasks; unknown/foreign IDs ignored. |
| `git_changes` | None | `{files:[porcelainLine],commits:[logLine]}` for local changes and commits outside the configured remote tracking branch. Does not fetch. Errors `git_not_configured`, `git_failed`. |
| `git_sync` | `message:string!` | `{commit:shortHash\|null,push:"ok"}`. Stages bot-root changes excluding `.temp`, commits if needed, pushes to configured branch; no pull/fetch. Errors `git_not_configured`, `invalid_argument` for blank message with staged changes, or `{commit,push:"failed",error:"git_sync_failed",description}`. Inspect `git_changes` before retrying: a local commit can already exist. |

## WebSocket tools

All records belong to the current bot/agent. See [websocket.md](websocket.md) for buffering, quotas, retention and administration; events are in [message-events.md](message-events.md).

| Tool | Arguments | Result |
| --- | --- | --- |
| `ws_open` | `url:string!`, `description:string!`, optional `headers:object` | `{connectionId}`. `ws:`/`wss:`, description 1–100 code points, string headers without CR/LF; at most ten records including closed ones. Keep URL/header secrets inside JavaScript. |
| `ws_list` | None | `{connections:[{connectionId,description,origin,status,openedAt,closedAt?,receivedBytes,sentBytes,queued,queuedBytes,binaryBytes}]}`; no full URLs/headers. |
| `ws_pull` | `connectionId:string!`, `count:integer!` | `{messages:[{type:"text",data}\|{type:"binary",bytes,path? ,skipped?,reason?}],remaining}`. Positive count, FIFO removal, including closed records. Binary skip reasons `binary_storage_full`, `file_expired`. |
| `ws_send` | `connectionId:string!`, optional `text:string`, `path:string` | `{status:"sent"}`. Exactly one text or permitted local file path; open connection required. |
| `ws_close` | `connectionId:string!` | `{status:"closed"}`. Keeps record/buffer/files for one hour; occupies a slot. |
| `ws_delete` | `connectionId:string!` | `{status:"deleted"}`. Removes record, unread buffer and remaining binary files; frees a slot. |

WebSocket errors: `invalid_argument`, `websocket_not_found`, `websocket_closed`, `websocket_limit`, `websocket_connect_failed`, `websocket_send_failed`. An open connection does not keep a Codex turn active. Notifications are hints; pull until `remaining` is zero or arrange a later continuation.

## Implementation references

The schemas are in [`src/codex/threads.mjs`](../src/codex/threads.mjs); dispatch and lifecycle checks in [`src/controller.mjs`](../src/controller.mjs). Focused automated coverage includes `codex`, `history-access`, `history-gap`, `message-actions`, `upload-reply`, `profile-download`, `rich-help`, `agent-messages`, `chat-info`, `readers`, `scheduler`, `vault`, `git` and `websocket*` under [`test/integration`](../test/integration). Administrator setup is documented separately in [commands.md](commands.md) and [master-bot.md](master-bot.md).

## Widget tools

All tools operate on the owning agent's registrations. See [widgets](widgets.md) for lifecycle, view targets, event admission and error details.

| Tool | Arguments | Result |
| --- | --- | --- |
| `create_widget` | `handler:string!`, `description:string!`, optional `state:object` | `{widgetId}`; zero views |
| `update_widget` | `widgetId:string!`, optional `handler`, `description`, `state` | `{widgetId,renderErrors}`; keeps views, repaints all, resumes stopped registrations |
| `set_widget_view` | `widgetId:string!`, exactly one `send:object` or `target:object`, optional `props:object` | `{viewId,target}`; commit binding only after confirmed publication |
| `delete_widget_view` | `viewId:string!` | `{}`; keeps message, disables buttons best effort; candidate IDs only clear diagnostics |
| `delete_widget` | `widgetId:string!` | `{}`; deletes registration/state/queue, leaves inactive messages |
| `list_widgets` | None | `{canCreate,items}` with own metadata, view counts and error flags |
| `get_widget` | `widgetId:string!` | Full committed state, views, last errors and possible publication candidates |
| `widget_event` | `widgetId:string!`, `name:string!`, optional JSON `data` | `{}` after queue admission, before execution |

`send:{}` defaults to the current chat; optional native creation fields are described in the widget article. `target` is either `{messageId,chatId?}` or `{inlineMessageId}`. Replacing an occupied owned view changes `viewId`; conflicts identify `ownerAgentId`, `widgetId` and `viewId`. Description is required only at creation. A failed `onInit` returns `widget_init_failed` with `widgetId`, `phase:"onInit"`, `status:"stopped"` and `causeCode`; valid saved partial state is retained. Direct errors are returned without duplicate agent notifications. Old set/render/resume tools are not public.
## Guest invocations

`read({guestRequestId})` returns the complete saved incoming guest message for its selected bot/agent only. Its native addresses do not grant ordinary chat access. `send({guestRequestId,...content})` returns `{inlineMessageId}`; `set_widget_view({widgetId,send:{guestRequestId},props:{}})` returns `{viewId,target:{inlineMessageId}}` and publishes the first render directly. Guest addressing excludes ordinary chat/topic/reply and notification/protection/effect fields. Supported content is text, rich_message, photo, animation, video, audio, voice, document, sticker, location, venue and contact when representable as one native inline result. Inline action buttons reuse existing permits/groups. Uploads, albums, polls, dice, video notes, ordinary reply keyboards, games and invoices are unsupported. Guest media may require `mime_type`, `thumbnail_url` and matching `file_sources`. See [Guest Mode](guest-mode.md) for examples, buffers, optional answers, 30-day retention, multiple successful publications and confirmed/uncertain failure handling. There is no separate answer_guest tool or local answer-count guard.

## Inline results

`set_inline_results` with `{requestId,results}` completes the current user's inline request. Results are friendly cards (`title`, optional `description`, `message`, thumbnail/URL fields) or `{native:{...},file_sources:[...]}` with supported Telegram InlineQueryResult fields. First accepted list wins; later calls return `already_set`. `[]` produces a Work complete placeholder. No uploads, games or invoices. Results wait in RAM for pagination within the original one-hour request lifetime. See [inline mode](inline.md) for action buttons, buffers, expiry and client limitations.

`read({inlineMessageId})` and `edit({inlineMessageId,...})` are alternatives to ordinary chat/message addressing, not additional selectors. Read returns only locally known confirmed edits with `partial` and possible `deliveryUnknown`; unknown content is unavailable, not fetched from Telegram. Inline edits accept native content fields and friendly `buttons` rows; require established owner and no widget binding. Uploads are forbidden; every reused inline file ID requires readable outer-message `file_sources` proof. Ordinary `via_bot` edits, including permits-only edits, are rejected; allowed deletion remains available.
