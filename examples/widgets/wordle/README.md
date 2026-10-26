# React Wordle and Nerdle

Install this entire directory as `widgets/wordle` in the owning agent's bot files. Keep all five broad and `-select` Wordle dictionaries, `classic_equations.txt`, its source metadata, and the helper modules together. The React entrypoints are `widget.tsx` (Wordle), `nerdle.tsx` (Nerdle), and `dictionary-admin.tsx` (dictionary editor). The original supplied ZIP is not modified by this example.

For a group with the bot present, create one widget per round. `wordMode` is `"shared"` (one hidden answer for everyone) or `"individual"` (one answer per player). The public results message and launcher are two views of the same widget:

```js
const {widgetId}=await create_widget({
  handler:"widgets/wordle/widget.tsx",
  description:"Wordle round",
  props:{title:"Wordle",length:5,wordMode:"shared"},
});
const players=await set_widget_view({widgetId,component:"Players",send:{}});
await set_widget_view({widgetId,component:"GameInput",
  send:{reply_parameters:{message_id:players.target.messageId}}});
```

Each click on the launcher opens a fresh private overlay for that player, including after Telegram Revert. The private game shows six custom-emoji rows and a colored keyboard made from clickable rich-message table cells; Backspace, DELETE, Enter, and Close are rich buttons in the message body. Close removes only that player's overlay; reopening preserves their guesses even if Telegram has already discarded the prior private message. Input and attempts are per player. In shared mode the public table shows all accepted guesses as colored cells without letters until an external actor ends the round. Individual mode shows styled letters. The table sorts wins, losses, then unfinished games; among equal outcomes, fewer attempts and shorter completed time rank higher. Duration begins with the first accepted guess.

For one-message inline or guest publication use only individual answers and the `GameShared` export. It presents the table plus a turn-based input with a 60-second active-player lease and a close button. On timeout the field remains visible with gray, no-op rich keys and a "В меню" button available to everyone. It does not open overlays:

```js
const {widgetId}=await create_widget({handler:"widgets/wordle/widget.tsx",
  description:"Inline Wordle",props:{wordMode:"individual",length:5}});
await set_widget_view({widgetId,component:"GameShared",
  send:{guestRequestId:"REQUEST_ID"}});
```

For Nerdle, change `handler` to `widgets/wordle/nerdle.tsx` and use `length:8`. The same `Players`, `GameInput`, and `GameShared` exports apply. Classic equations are selected from the shipped answer pool and guesses must be valid eight-character equations.

The round ends only when an external actor rotates or closes it. Both Wordle and Nerdle export `finishRound`, which sets the finished time, reveals the answer(s), disables play and closes private overlays. A win or loss by one player does not end the round for others. To finish and detach while preserving the final table:

```js
const result=await dispatch_widget_action({widgetId,action:"finishRound"});
// result.updatedViews contains each confirmed Telegram edit.
await delete_widget({widgetId});
```

The awaited action confirms the final repaint before deletion can disable buttons. If it rejects, inspect `get_widget` and its `updatedViews`/`failedViews` error details: the state may already be finished while one view failed to publish. Repair or retry the failed view before deleting. Deletion leaves the last message body visible. Retain the widget if the final view needs to stay interactive; create a new widget for the next round.

The dictionary editor is a separate widget:

```js
const chatId=-1001234567890;
const anchorMessageId=123; // An existing message in the same group.
const {widgetId}=await create_widget({handler:"widgets/wordle/dictionary-admin.tsx",
  description:"Wordle dictionary",props:{auditChatId:chatId}});
await set_widget_view({widgetId,component:"Editor",
  send:{chatId,reply_parameters:{message_id:anchorMessageId}}});
```

In a group or supergroup, publish Wordle, Nerdle, and the dictionary editor as a reply to a stable message in the same chat, for example `send:{chatId,reply_parameters:{message_id:anchorMessageId}}`. Telegram has stripped custom-emoji tiles from edits to standalone rich messages in live tests; a reply-created message preserved them. Keep the anchor available while the view is active.

Only the `-select` files supply future answers. Broad and selected words together permit guesses. Editor mutations use the dictionary store's file lock, atomic replacement, rollback and audit log. Existing rounds retain their already selected answers. Widget creation and publication use the controller's owner and chat-role checks; once published, Add, Remove, and Use buttons accept any Telegram user with a valid user ID, as in the supplied editor.
