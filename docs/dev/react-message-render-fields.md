# Interactive message render fields

Verified against the official Telegram Bot API on 2026-10-12 and the controller source at design time. This is the historical native-field inventory, not an execution report. The implemented SDK is described in [widgets](../widgets.md), with [implementation verification](widgets-verification.md); decisions are recorded in the [discussion](react-messages-discussion.md).

## How to read this reference

- The supported scope is every **single-message** content type currently routed by `send`: text, rich, photo, video, animation, document, audio, voice, sticker, video note, location, venue, contact, poll and dice. Live location uses the location content field. Albums have multiple message IDs and remain outside this single-message render contract.
- Native send fields are listed completely below, separated into content and request-envelope fields. Listing a native field does not authorize business-account, paid-broadcast, ephemeral, suggested-post or direct-message-topic features in the SDK; these are not part of the agreed scope.
- During first publication, the controller sends the initial content. On subsequent renders, unchanged creation-only fields are retained; a request to change an immutable field fails instead of silently resending, deleting or changing the message ID.
- Editable means Telegram has a method/input field for it. Some metadata is only accepted as part of media replacement, not as an independent edit, and can be ignored when a stored file is reused. These cases require live verification before SDK guarantees.
- Server-owned results, such as `dice.value`, poll counters and uploaded `file_id`, are read-only outputs, not fields to set in render.
- Native external type transitions are now accepted for widgets; see the [conversion matrix and live verification](widget-type-conversions.md). The current controller's original-type check has not yet been changed by this design investigation.

## Shared fields

For ordinary text, the accepted SDK design supports either a string with native `parse_mode`/`entities` or JSX compiled into plain text and UTF-16-based entities. JSX here supports ordinary text formatting only, not rich blocks. Dynamic JSX strings are text, not injected HTML. Manual HTML requires escaping. Specifying both `parse_mode` and `entities` is an error. Native captions use the corresponding `caption`/`parse_mode`/`caption_entities` contract; caption JSX support has not been separately specified.

| Fields | Creation | Subsequent render |
| --- | --- | --- |
| `reply_markup` | Native methods below accept it | Update inline keyboard with `editMessageReplyMarkup`, or combine with a supported content edit. Reply keyboards/ForceReply are not the interactive-message keyboard contract. |
| `caption`, `parse_mode`, `caption_entities` | photo/video/animation/document/audio/voice | Change through `editMessageCaption`; for replaceable media they can also accompany `editMessageMedia`. `caption:""` removes the caption. Use entities or parse mode, not competing representations. |
| `show_caption_above_media` | photo/video/animation | Change via caption or media edit. Not supported for document/audio/voice. |
| `chat_id`, `message_thread_id` | Destination at creation | Cannot move an existing message to another chat/topic. The SDK uses `chatId`/`topicId` at registration. |
| `reply_parameters` | Reply relationship at creation | No method for changing the original reply relationship. |
| `disable_notification`, `protect_content`, `allow_paid_broadcast`, `message_effect_id` | Send-time options | Not editable render fields. `allow_paid_broadcast` spends Stars and is not implicitly enabled by this inventory. |
| `business_connection_id` | Native routing on behalf of a business account | Not a render-controlled identity switch; outside agreed SDK scope. |
| `direct_messages_topic_id`, `ephemeral_message_parameters`, `suggested_post_parameters` | Only methods whose inventory below includes them | Outside agreed SDK scope. Do not pass them indiscriminately to every send method. |
| `permits` | Controller-local callback permissions | Local state, not a Telegram field. Retain the agreed controller permission checks; coordinate visible buttons with local permission changes. |

Sources: [updating messages](https://core.telegram.org/bots/api#updating-messages), [caption edits](https://core.telegram.org/bots/api#editmessagecaption), [keyboard edits](https://core.telegram.org/bots/api#editmessagereplymarkup).

## Per-type creation and edit matrix

The content-column lists fields in addition to the applicable shared send envelope. `parse_mode`/`entities` here refer to the text unless explicitly identified as caption formatting.

| Type / send method | Complete content-specific send fields | Editable content | Creation-only / immutable content |
| --- | --- | --- | --- |
| Text / `sendMessage` | `text`, `parse_mode`, `entities`, `link_preview_options` | All listed fields through `editMessageText` | No additional content fields |
| Rich / `sendRichMessage` | `rich_message` | Replace the full rich document with `editMessageText.rich_message` | No additional content fields; individual internal patches are not a native edit method |
| Photo / `sendPhoto` | `photo`, `caption`, `parse_mode`, `caption_entities`, `show_caption_above_media`, `has_spoiler` | Photo and spoiler through `InputMediaPhoto`; caption/formatting/placement independently | None of these are intrinsically creation-only, subject to media-reuse rules |
| Video / `sendVideo` | `video`, `duration`, `width`, `height`, `thumbnail`, `cover`, `start_timestamp`, `caption`, `parse_mode`, `caption_entities`, `show_caption_above_media`, `has_spoiler`, `supports_streaming` | Media, cover, start timestamp, spoiler and listed metadata through `InputMediaVideo`; caption/formatting/placement independently | No standalone edit of duration/dimensions/thumbnail/streaming metadata; replacement-input support does not guarantee overriding cached file metadata |
| Animation / `sendAnimation` | `animation`, `duration`, `width`, `height`, `thumbnail`, `caption`, `parse_mode`, `caption_entities`, `show_caption_above_media`, `has_spoiler` | Media, spoiler and listed metadata through `InputMediaAnimation`; caption/formatting/placement independently | Metadata/thumbnail only as part of media replacement, with upload restrictions |
| Document / `sendDocument` | `document`, `thumbnail`, `caption`, `parse_mode`, `caption_entities`, `disable_content_type_detection` | Media and listed upload options through `InputMediaDocument`; caption/formatting independently | Thumbnail/content-detection settings are upload-specific, not independent edits of an already stored file |
| Audio / `sendAudio` | `audio`, `caption`, `parse_mode`, `caption_entities`, `duration`, `performer`, `title`, `thumbnail` | Media and listed metadata through `InputMediaAudio`; caption/formatting independently | Metadata/thumbnail only as part of media replacement; stored-file metadata may prevail |
| Voice / `sendVoice` | `voice`, `caption`, `parse_mode`, `caption_entities`, `duration` | Caption/formatting | `voice`, `duration`; `InputMediaVoiceNote` exists for rich but does not add voice to `editMessageMedia`'s supported standalone types |
| Video note / `sendVideoNote` | `video_note`, `duration`, `length`, `thumbnail` | Inline keyboard only | All listed content fields; no caption field |
| Sticker / `sendSticker` | `sticker`, `emoji` | Inline keyboard only | Sticker and emoji; send-time emoji applies to newly uploaded stickers |
| Static location / `sendLocation` | `latitude`, `longitude`, `horizontal_accuracy`; the method also accepts live-only fields listed next | Inline keyboard only | Coordinates/accuracy; do not assume conversion into live location by editing |
| Live location / `sendLocation` | `latitude`, `longitude`, `horizontal_accuracy`, `live_period`, `heading`, `proximity_alert_radius` | All listed fields through `editMessageLiveLocation` while active, with period restrictions | Cannot restart an expired/explicitly stopped broadcast on the same message |
| Venue / `sendVenue` | `latitude`, `longitude`, `title`, `address`, `foursquare_id`, `foursquare_type`, `google_place_id`, `google_place_type` | Inline keyboard only | All listed content fields |
| Contact / `sendContact` | `phone_number`, `first_name`, `last_name`, `vcard` | Inline keyboard only | All listed content fields |
| Poll / `sendPoll` | Full list in the poll section | Inline keyboard; closing is a separate `stopPoll` action | All creation parameters from render; participant-driven option additions are the exception described below |
| Dice / `sendDice` | `emoji` | Inline keyboard only | Emoji and generated result; changing state must never implicitly roll again |

Method references: [text](https://core.telegram.org/bots/api#sendmessage), [rich](https://core.telegram.org/bots/api#sendrichmessage), [photo](https://core.telegram.org/bots/api#sendphoto), [video](https://core.telegram.org/bots/api#sendvideo), [animation](https://core.telegram.org/bots/api#sendanimation), [document](https://core.telegram.org/bots/api#senddocument), [audio](https://core.telegram.org/bots/api#sendaudio), [voice](https://core.telegram.org/bots/api#sendvoice), [video note](https://core.telegram.org/bots/api#sendvideonote), [sticker](https://core.telegram.org/bots/api#sendsticker), [location](https://core.telegram.org/bots/api#sendlocation), [venue](https://core.telegram.org/bots/api#sendvenue), [contact](https://core.telegram.org/bots/api#sendcontact), [poll](https://core.telegram.org/bots/api#sendpoll), [dice](https://core.telegram.org/bots/api#senddice).

## Media edits, uploads and cache exceptions

- `editMessageMedia` accepts photo/video/animation/audio/document and native live photo. Standalone voice, video note and sticker are not included. Native live photo is not in the agreed standalone SDK scope.
- The replacement object is native `InputMedia*`: it uses `type` and `media`, not the send-method content key. The SDK must translate its author-facing result correctly and preserve unspecified components according to the chosen render semantics.
- Photo/video/animation spoiler changes use `has_spoiler` in media input. They are not caption edits.
- `thumbnail` is JPEG, under 200 kB, with both dimensions at most 320. It cannot be reused by `file_id`; it is uploaded as a new attachment and is ignored when the primary file is not uploaded through multipart. **Do not apply the ordinary file-ID cache to thumbnails.** The native service may generate/ignore a thumbnail even during upload.
- Video `cover` is separate from `thumbnail`; its input accepts a file ID, URL or attachment. Its resolver/cache needs its own role/type and must not use the video's file ID as the cover's ID.
- `duration`, dimensions, `performer`, `title` and `supports_streaming` are accepted in relevant replacement inputs, but are not unrestricted mutable labels on an existing Telegram file. Tests must cover reuse versus fresh upload before promising their exact effect.
- `disable_content_type_detection` only affects multipart uploads; it is not a way to relabel a stored file.
- Uploaded file names come from the multipart attachment's filename, not a generic `file_name` render property. Changing a document filename is not an independent native rename edit; reuse-versus-upload behavior needs explicit testing if exposed.
- A file ID belongs to a bot and a media type. A photo ID cannot simply be reused as a document ID. `file_unique_id` is not a send/download ID.
- Video notes do not support URL sending. Animated/video stickers cannot be sent by URL; static WEBP stickers can. Therefore the generic string-source resolver must validate the target type before treating every HTTPS URL as usable.
- URL delivery also has native MIME/size/type restrictions; do not promise that a URL valid for photo is valid for document/voice. These are separate from cache-key equality.
- An edit to an inline-mode message cannot upload a new file. An **inline keyboard under an ordinary chat message** does not make it an inline-mode message. The latter restriction does not apply to normal chat-message uploads.
- For native albums, edit each existing message, preserving Telegram's album category restrictions. No API appends a new element to an already sent native album. Rich slideshow/collage replacement is a different operation.

Sources: [media edit](https://core.telegram.org/bots/api#editmessagemedia), [InputMediaVideo](https://core.telegram.org/bots/api#inputmediavideo), [InputMediaAudio](https://core.telegram.org/bots/api#inputmediaaudio), [InputMediaDocument](https://core.telegram.org/bots/api#inputmediadocument), [sending files](https://core.telegram.org/bots/api#sending-files).

## Rich document details

- Native `InputRichMessage` accepts exactly one of `blocks`, `html`, `markdown`; optional `media`, `is_rtl`, `skip_entity_detection`. JSX is planned to compile into blocks, not be transmitted literally.
- Full-document replacement can add/remove/reorder supported media, map blocks, slideshows, details, lists, tables and buttons while retaining the outer rich type. A media block's caption is the rich block caption (`text`, optional `credit`); native InputMedia captions are not its caption source.
- Rich uses photo/video/animation/audio/document/voice-note input media, including the corresponding media properties. A voice-note block may be replaced as part of a full rich document even though a standalone voice message cannot be replaced through `editMessageMedia`.
- Map blocks have `location:{latitude,longitude}`, `zoom`, `width`, `height`, optional caption. Replacing these changes a rich map, not native live location. Do not import live-location lifetime semantics into a rich map.
- Rich media limits and allowed container nesting apply to every render. Numeric/document limits, formatting and tag support remain defined by the official source; the test matrix must cover the combinations actually exposed by the SDK.
- Current rich limits: 32,768 UTF-8 characters as defined by Telegram, 500 blocks including nested items/rows, 16 nesting levels, 50 attachments and 20 table columns. Map zoom is 0–24; width+height is at most 10,000 and aspect ratio at most 20. These limits are checked separately from ordinary text/caption limits.
- Thinking blocks/drafts are not included in the agreed interactive-message API.

Sources: [InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage), [rich limits and formatting](https://core.telegram.org/bots/api#rich-message-formatting-options), [InputRichBlockMap](https://core.telegram.org/bots/api#inputrichblockmap), [InputRichMessageMedia](https://core.telegram.org/bots/api#inputrichmessagemedia).

## Poll parameters and changes originating outside render

Complete content-specific `sendPoll` fields:

| Group | Fields |
| --- | --- |
| Question | `question`, `question_parse_mode`, `question_entities` |
| Options | `options` (native `InputPollOption[]`) |
| Voting behavior | `is_anonymous`, `type`, `allows_multiple_answers`, `allows_revoting`, `shuffle_options`, `allow_adding_options`, `hide_results_until_closes` |
| Participant restrictions | `members_only`, `country_codes` |
| Quiz | `correct_option_ids`, `explanation`, `explanation_parse_mode`, `explanation_entities`, `explanation_media` |
| Lifetime | `open_period`, `close_date`, `is_closed` |
| Description | `description`, `description_parse_mode`, `description_entities`, `media` |

Each `InputPollOption` accepts `text`, `text_parse_mode`, `text_entities`, `media`. Native `InputPollOptionMedia` and `InputPollMedia` have different allowed media unions; a general rich media resolver is not enough to validate these. The current option union is animation/link/live-photo/location/photo/sticker/venue/video; description/explanation media is animation/audio/document/live-photo/location/photo/venue/video. Listing these unions does not add standalone live-photo support to the SDK.

Conditions:

- Current API accepts 1–12 options. `correct_option_ids` is a sorted array of zero-based indices and is required for quiz mode; do not substitute the older singular field name.
- Question and option formatting currently allow custom emoji entities only; description/explanation have their own formatting fields. Do not automatically apply ordinary text formatting everywhere.
- `allow_adding_options` is unavailable for anonymous polls and quizzes. It allows Telegram participants to add options; it does not expose arbitrary edit of existing option text or question through render or an `editPoll` method. Do not invent such a method.
- `allows_revoting` changes whether participants may change their selected options. It does not grant editing of the poll definition.
- `open_period` and `close_date` are mutually exclusive. Current `open_period` bounds are 5–2,628,000 seconds; `close_date` has the corresponding relative range when creating the poll.
- `members_only` is channel-specific. Country restrictions and other combinations must be checked against native validation, not silently ignored.
- `stopPoll` is an explicit irreversible closing action on an existing poll, optionally updating its inline keyboard. There is no native reopen operation. Changing `is_closed` in render must not silently create another poll or be treated as a general edit method; its SDK mapping remains to be decided.
- `poll` updates provide the latest aggregate poll object. `poll_answer` updates provide vote/revote/withdrawal for the bot's own non-anonymous poll. Handle `user` or `voter_chat`; an empty selection retracts the vote. Prefer `option_persistent_ids` for durable bookkeeping when options are added/shuffled.
- Received counters/options/closed state are native observations, not an illegal script mutation. Maintain a separate observed message/poll snapshot rather than overwriting the script's creation specification and then rejecting it as changed on the next render.
- Link `poll_id` to its registration/message. `poll`/`poll_answer` must be added to `allowed_updates` and routed to the appropriate script; they are not enabled in the current polling implementation. Their SDK handler names are still proposals, unlike the accepted `created` lifecycle event.

Sources: [sendPoll](https://core.telegram.org/bots/api#sendpoll), [InputPollOption](https://core.telegram.org/bots/api#inputpolloption), [InputPollOptionMedia](https://core.telegram.org/bots/api#inputpolloptionmedia), [InputPollMedia](https://core.telegram.org/bots/api#inputpollmedia), [PollAnswer](https://core.telegram.org/bots/api#pollanswer), [Update](https://core.telegram.org/bots/api#update), [stopPoll](https://core.telegram.org/bots/api#stoppoll).

## Dice result and creation lifecycle

The user accepted `created(ctx,event)` after confirmed initial publication, with the returned native Message in `event.message`. A dice result is already in `event.message.dice.value`; it is not a separate animation-finished update. Save it in state to render conditional buttons. Do not write `value` into the sendDice input.

`created` must not run after every edit/render/restart and trigger repeated rewards or sends. For attachment of a handler to an existing message and replacement of a handler on the same message, whether a distinct initialization event carries the existing Message remains open. Crash recovery of the one-time creation event also requires a separate decision; do not claim exactly-once external effects.

## Live location conditions

- Initial `live_period`: 60–86,400 seconds or `2147483647` for indefinite updates.
- It is measured from the original message send time, not from the most recent render.
- On edit, an ordinary new period cannot exceed the existing value by more than one day, and its expiration must stay within the next 90 days. The indefinite sentinel is supported separately.
- `horizontal_accuracy`: 0–1,500 metres; `heading`: 1–360 degrees; `proximity_alert_radius`: 1–100,000 metres. Heading/proximity are live-location options.
- Coordinate updates stop being available after expiry or `stopMessageLiveLocation`. Rendering cannot restart that same broadcast. A new broadcast requires a new message.
- Removing/stopping a script and stopping Telegram's live broadcast are different operations. Whether script stop must also call `stopMessageLiveLocation` remains open; do not silently decide it from callback-button disabling.

Sources: [sendLocation](https://core.telegram.org/bots/api#sendlocation), [editMessageLiveLocation](https://core.telegram.org/bots/api#editmessagelivelocation), [stopMessageLiveLocation](https://core.telegram.org/bots/api#stopmessagelivelocation).

## Exact native envelope availability

All 15 send methods in this scope include `business_connection_id`, `chat_id`, `message_thread_id`, `disable_notification`, `protect_content`, `allow_paid_broadcast`, `message_effect_id`, `reply_parameters`, `reply_markup`.

Additional envelope fields are not universal:

| Field | Applicable methods |
| --- | --- |
| `direct_messages_topic_id` | All listed send methods except `sendPoll` |
| `ephemeral_message_parameters` | All listed send methods except `sendPoll` and `sendDice` |
| `suggested_post_parameters` | All listed send methods except `sendPoll` |

Edit methods have their own fixed addressing fields (`business_connection_id`, `chat_id`, `message_id`, `inline_message_id` where supported). They do not accept the send envelope as a general patch. The registration/permissions layer controls addressing.

## Controller gaps and verification scope

The native inventory above exceeds the exposed controller contract:

- `src/codex/threads.mjs` defines top-level tool properties and rejects unknown arguments through its schema. Supporting a send method internally is not the same as exposing every one of its parameters to agents.
- `src/messages/actions.mjs` preserves original outer type, dispatches text/rich/caption/media/keyboard edits, but does not expose live-location edits, live-location stop or poll stop.
- Current edit dispatch does not forward `link_preview_options` or `show_caption_above_media` in its text/caption edit components. The new render adapter must deliberately map them; examples alone do not implement support.
- Current top-level media convenience edits do not carry all the native InputMedia metadata. The future SDK must construct the correct `media` object, rather than rely on the simplified existing path.
- The existing file walker recognizes ordinary/rich media references but does not fully validate thumbnails or all poll-media unions. New resolver/cache coverage and provenance handling require implementation.
- Current `src/telegram/polling.mjs` omits `poll` and `poll_answer` from `allowed_updates`.

Validation for this document: official send/edit/InputMedia/InputPoll field inventory compared to the tables; current tool schemas and edit dispatch read; local documentation links checked. **No live Telegram acceptance or SDK implementation was performed for this audit.** Required live tests include rich media mapping, thumbnails/covers, media metadata under reuse, poll option additions/revotes, and live-location expiry/stop.
