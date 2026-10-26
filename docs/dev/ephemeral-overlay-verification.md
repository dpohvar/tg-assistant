# Ephemeral overlay and original-message edits

## Scope

Native Telegram Bot API experiment in an already observed test group. An ordinary bot message opened a personal replacement using `ephemeral_message_parameters.replace_callback_query_message`. The user advanced each operation with a callback button. No production controller behavior or widget API was changed.

## Observed sequence

1. An ordinary-message callback created the overlay; the next callback addressed its `ephemeral_message_id` with ordinary `message_id: 0`.
2. `editMessageText` changed the original text while retaining its original keyboard. The user observed that the overlay disappeared. The next callback addressed the ordinary original, corroborating that observation.
3. `editMessageReplyMarkup` changed only the original keyboard. Its following callback also addressed the ordinary original. Since the overlay had already disappeared at step 2, this sequence does not independently isolate keyboard-only invalidation of a freshly visible overlay. The user's overall observation was that original-message edits dismissed the overlay.
4. `editEphemeralMessageText` succeeded against the existing overlay address. The following callback addressed that same ephemeral ID, showing that editing the overlay made the private version accessible again after the original edit.
5. `deleteEphemeralMessage` succeeded. The next callback addressed the ordinary original again.

These are observations of this live run, not a documented cross-client guarantee. The experiment did not identify a client version and did not exercise an independent second platform.

## Implication

Treat an original-message edit as capable of dismissing its personal overlay. A continuously rerendered shared widget cannot assume that its personal menu will stay visible. Dismissal does not necessarily mean the ephemeral address was deleted: editing that address restored an interactive private version in this run. Automatically reapplying overlays after every shared render has not been implemented or evaluated.

## Cleanup

The runner exited successfully, removed only its own test messages, restored the prior update subscription, and released the exclusive test-bot lock. A second cleanup attempt for the explicitly deleted overlay returned `MESSAGE_NOT_FOUND`, as expected. No command lists or bot membership were changed. No application-code or current wiki contract update was needed.

## Guest reply in a supergroup without the bot

A separate bounded native probe accepted an explicitly tagged guest invocation from the designated participant in a supergroup where the bot was absent. `answerGuestQuery` successfully published a text reply with an Open overlay button. Both button presses delivered an inline callback containing `inline_message_id`, without a `message` object.

Each fresh callback immediately triggered `sendMessage` to the original guest chat with the clicking user's `receiver_user_id`, the received `callback_query_id`, and `replace_callback_query_message: true`. Both attempts were rejected with `Forbidden: bot is not a member of the supergroup chat`. No overlay was created. The user saw the same error in the callback alert. This establishes that the tested native overlay route does not bypass supergroup membership through a guest callback; it does not establish behavior for a guest-originated message after subsequently adding the bot.

The guest probe then exited successfully, restored the previous update subscription, released the shared test-bot lock and removed its own private test notices. The guest card was edited to a finished message with an empty keyboard through its owned inline ID. It remains in the group: there is no native delete-by-inline-ID operation used by this probe. No bot membership or command registration changes were made.

## Protocol investigation after the rejected guest send

The failure must not be generalized to all Telegram transports. Source inspection found a guest-specific MTProto route which was not exercised by either live probe.

- The official HTTP Bot API implementation at revision `e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1` parses ephemeral parameters, but `do_send_message` invokes `check_reply_parameters`, then `check_message_topic`, then `check_chat` with write access before reaching `td_api::sendEphemeralMessage`. Supergroup nonmembership fails at that gate. Its `answerGuestQuery` handler passes only the guest query ID and inline result; it does not expose a private receiver or ephemeral send parameters. [Source](https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp).
- Telegram's official MTProto schema at TDLib revision `631edce27b702691e9a603059c78550b6b533a64` defines `ephemeral.sendMessage` with optional `peer`, `query_id`, a receiver, and an `anchor` flag. Its edit/delete methods also have optional peers. Schema support alone does not prove the server will accept every combination. [Schema](https://github.com/tdlib/td/blob/631edce27b702691e9a603059c78550b6b533a64/td/generate/scheme/telegram_api.tl).
- mtcute revision `d65b12dd374636dc13f7216bcc9ce66a7c2728c7` explicitly documents a null chat address for guest chats with `queryId` instead, and sends `ephemeral.sendMessage` with the peer omitted. This is a concrete client implementation of a guest ephemeral-send route. [Implementation](https://github.com/mtcute/mtcute/blob/d65b12dd374636dc13f7216bcc9ce66a7c2728c7/packages/core/src/highlevel/methods/ephemeral/send-ephemeral-message.ts).

The next meaningful probe is direct MTProto bot authentication and a private guest response by query ID without a chat peer. A second case must establish whether a callback on an already published guest response can produce an anchored replacement; guest-private delivery and replacement of a public original are separate claims. Neither direct MTProto delivery nor guest overlays have passed a live test here. No MTProto dependency, bot session, server patch or production behavior was introduced during this investigation.

## Direct MTProto probe

After the application credentials were supplied locally, isolated mtcute 0.32.5 successfully authenticated the designated test bot and persisted its own session. The initial identity-only check disabled updates and closed the connection; the subsequent bounded runner receives native MTProto updates. Dependencies and credentials are confined to ignored probe files, with no project dependency or production configuration changes.

The first fresh guest invocation called `sendEphemeralMessage(null, receiver, text, {queryId: guest.id})`. Telegram rejected it with `400 QUERY_ID_INVALID`, approximately 81 milliseconds after the guest update reached the handler. No private message was created. This rejects that tested use of the original guest query ID; it does not prove a query deadline or support the earlier assumption that the guest query ID is interchangeable with a callback query ID.

The callback-driven case subsequently published an ordinary guest card, received its native inline callback, and called `sendEphemeralMessage(null, receiver, text, {queryId: callback.id, anchor: true})`. The user observed the private version replacing the guest original and supplied a screenshot with Telegram's private-version indicator and a native Revert context-menu action. This is live evidence of an overlay without supergroup membership through direct MTProto.

The probe nevertheless showed an error alert after the successful send. Investigation identified a probe-side diagnostic access to `message.chat`: mtcute attempted to resolve the returned raw chat peer against an incomplete per-response peer index and threw `Given peer is not available in this index`. The getter failure happened while recording the receipt, so the initial attempts were not saved as successful private receipts. A local incomplete-peer reproduction confirmed the diagnostic failure; the probe now records IDs and flags directly from the raw receipt without resolving the chat. It resumed on the same owned guest card with no dependency or production code changes.

## Confirmed direct MTProto outcome

The resumed run obtained and saved a confirmed private receipt. Its next callback came from that ephemeral message; `editEphemeralMessage` with a null chat address succeeded. The following ephemeral callback triggered `deleteEphemeralMessage`, also with a null chat address, which succeeded. A subsequent callback came from the original inline message again. The user explicitly confirmed that the full opening, editing and deletion sequence worked visually and that the original returned.

| Case | Live result |
|---|---|
| HTTP Bot API overlay send to guest supergroup by numeric chat ID | Rejected: bot is not a member |
| Direct MTProto private send by original guest invocation query ID | Rejected: QUERY_ID_INVALID |
| Direct MTProto anchored send by a fresh inline callback ID, with peer omitted | Passed; personal overlay replaced the guest original |
| Direct MTProto edit/delete of the saved private receipt, with peer omitted | Passed; original returned after deletion |
| Native client Revert menu action | Present in the observed client; not separately exercised |

This establishes the callback-driven guest overlay route in the observed client, not a general right to send hidden replies to any guest invocation. HTTP Bot API restrictions and direct MTProto operations must remain distinct. Integration, event routing between transports, delayed callback handling, other participants/clients and media overlays have not been validated here.

Switching the HTTP send from `sendMessage` to `sendRichMessage` does not remove the observed membership gate in the inspected Bot API implementation: both handlers delegate to the same `do_send_message` path before the access check and ephemeral send. Both HTTP methods document a required `chat_id`; the documented `answerGuestQuery` request contains only `guest_query_id` and an inline result, with no ephemeral send parameters. General instructions to pass a callback ID and `replace_callback_query_message` therefore describe the already tested parameter combination, not a distinct confirmed guest-compatible HTTP route. A live `sendRichMessage` variation was not run; this conclusion about the common gate comes from the official source inspection.

Additional proposed HTTP request shapes were checked directly against the designated bot using intentionally invalid query IDs and no message targets, so no messages could be created or edited. `answerGuestQuery` with top-level `guest_query_id`, `text` and `ephemeral_message_parameters` returned `Bad Request: result isn't specified`. `editEphemeralMessageText` with only `callback_query_id`, `text` and empty `reply_markup` returned `Bad Request: invalid receiver_user_id specified`. Adding the designated receiver while still omitting `chat_id` returned `Bad Request: chat_id is empty`. This validates rejection of the proposed request shapes; it is not an additional live UI or guest-delivery test.

The official edit handler reads `chat_id`, `receiver_user_id` and `ephemeral_message_id` and does not implement callback-only addressing. The guest answer handler does not read ephemeral parameters. A guessed private flag must therefore not be assumed to make a valid guest inline result private: the inspected handler can ignore such an extra field while publishing an ordinary result.

The resumed runner stopped successfully, deleted its confirmed private receipt, deactivated its owned guest card, removed its private notices and released the shared test-bot lock. The MTProto session remains stored in the ignored probe directory for later authorized experiments. No project dependencies, production bot routing, command lists or memberships were changed.
