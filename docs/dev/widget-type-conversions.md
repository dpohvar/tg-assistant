# Widget message type conversions

Design investigation and bounded live Bot API verification, 2026-10-12. Widget implementation has not started. The user approved supporting native conversions rather than imposing a fixed outer message type.

## Native API contract

The current official reference identifies Bot API 10.3. Relevant methods are [editMessageText](https://core.telegram.org/bots/api#editmessagetext), [editMessageMedia](https://core.telegram.org/bots/api#editmessagemedia), and [editMessageLiveLocation](https://core.telegram.org/bots/api#editmessagelivelocation).

`editMessageText` handles text/rich/game messages with text or rich content. `editMessageMedia` accepts animation/audio/document/live-photo/photo/video replacements, including replacing an existing text or rich message. There is no documented inverse method removing standalone media and returning to text/rich.

The documentation explicitly restricts album conversions: audio albums retain audio; document albums retain document; other supported albums retain photo/live-photo/video. Editing inline-mode media cannot upload new files. An ordinary chat message with an inline keyboard is not an inline-mode message. These restrictions do not prevent native conversions of an ordinary singleton widget.

Native method support and valid source data are separate: a photo file ID is not an audio/document file ID, and wrong codecs, file size or MIME can fail independently of a permitted conversion. Use a valid attachment/file ID for the target type. This report verifies singleton messages, not all file-upload variants or albums.

## Verified singleton conversion matrix

`M` below means photo, video, animation, audio or document. Each accepted edit preserved the original message ID and returned the expected target type.

| Source | Target | Method | Evidence / result |
| --- | --- | --- | --- |
| Text | Rich | `editMessageText` | Live accepted |
| Rich | Text | `editMessageText` | Live accepted |
| Text or rich | Any M | `editMessageMedia` | All 10 transitions live accepted |
| Any M | Any other M | `editMessageMedia` | All 20 distinct transitions live accepted |
| Any M | Text or rich | `editMessageText` | All 10 transitions live rejected: `there is no text in the message to edit` |
| Dice, poll, static location, venue, contact | Photo | `editMessageMedia` | All five live rejected: `message media can't be edited` |
| Static location or venue | Live location | `editMessageLiveLocation` | Both live rejected: `message can't be edited` |
| Voice, video note, sticker | M | Not documented as editable source types | Voice creation blocked by recipient privacy; other source transitions not live tested |
| Any source | Voice, video note, sticker, poll, dice, venue or contact | No matching conversion method | Not supported by the documented conversion API; not an exhaustive live failure matrix |

Live photo is also a documented native media source/target and must not be excluded from permitted conversions merely because the original singleton SDK inventory omitted it. The implementation plan must cover its native input mapping. It was not live tested. Games and ephemeral/business/inline-mode messages are likewise outside this probe's scope; their publishing features are not added by the conversion decision alone.

Editing captions or keyboards does not convert the outer type. Those operations remain available where natively supported, including keyboards for dice and polls. Live-location editing remains limited to an active broadcast; it is not a conversion API for static locations, and cannot restart an expired/stopped broadcast.

## Live verification

The [manual probe](../../test/manual/widget-type-conversion-probe.mjs) ran against the designated test bot in the existing private test dialogue, directly through the Bot API. It did not use the current controller's type guard, invoke a model, consume updates, or change the running service configuration.

The main run tested 30 distinct transitions among text/rich/photo/video/audio/document and four immutable-source-to-photo failures. The extra run tested 12 animation transitions, venue-to-photo and two live-location attempts. Total: **49 edit attempts, 32 accepted, 17 rejected**. Every accepted conversion returned the expected target type with the same message ID.

Voice was attempted separately but creation failed with `user restricted receiving of voice note messages`; this is not evidence about conversion support. No receiver setting was changed. Static location-to-live and venue-to-live were tested directly instead of inferred from missing documentation.

Only newly created test messages were edited. Cleanup removed all generated messages it could, except one fresh dice message: Telegram rejected its deletion. In a private chat, the documented [deleteMessage](https://core.telegram.org/bots/api#deletemessage) rules restrict deleting dice until more than 24 hours after sending. No automatic delayed cleanup was scheduled.

Animation fixtures require care. An MP4 with an audio track submitted to `sendAnimation` returned a video; a minimal synthetic GIF returned a document. Those fixture-preparation trials were cleaned up and excluded from the conversion matrix. The successful extra run used an actual animated GIF, with source and resulting Message type checked before editing. Public fixture media are not checked into the repository. Raw sanitized outcomes stay in ignored `.runtime-check` files.

## Widget implementation rules

1. Permit every native transition supported by Telegram without deleting/resending the Telegram message or changing widget identity. The verified matrix is evidence, not an application allowlist. Unverified does not mean forbidden, and also does not mean proven successful.
2. Dispatch from the current confirmed Message type, not the widget's original creation type. A text widget converted to photo can subsequently change among M but cannot return to text/rich.
3. After a confirmed edit, replace the saved full Message/projection and refresh `ctx.message`. Do not leave stale source content fields after changing type. Preserve controller-owned reaction/poll projections as applicable.
4. Render may change editable content/keyboard while unchanged immutable fields are retained. Reject unsupported transitions before side effects where the policy is known. A rejected render follows the agreed error/disable policy, not a hidden replacement send.
5. Convert author-facing media fields to the correct native InputMedia shape and resolve/upload media for the target type. Type is part of the upload/file-ID cache role.
6. Include the conversion and resulting asymmetric capabilities in SDK examples, agent instructions and tests. Record transport uncertainty separately from an explicit API rejection.

At investigation time, `src/messages/actions.mjs` rejected changes of original outer type. Widget implementation removed that extra restriction and aligned ordinary editing with the shared native dispatcher. See the [current widget article](../widgets.md) and [implementation verification](widgets-verification.md) for current behavior; this document preserves the original investigation evidence.

## Remaining verification limits

Voice-source conversion would need a recipient/chat permitting voice creation. Video-note/sticker source failures, live-photo transitions, album restrictions, inline-mode restrictions, business messages and all possible media encodings were not exhaustively live tested. Native methods/input schemas define the available requests, with Telegram deciding the result. Do not invent unsupported target input types or impose a permanent extra source-type allowlist merely because a pair is undocumented or untested. These limits do not invalidate the verified singleton matrix.
