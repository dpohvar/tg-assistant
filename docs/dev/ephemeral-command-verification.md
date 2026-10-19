# Ephemeral command verification

Status: both the initial controller-command iteration and subsequent `/say` iteration are implemented, reviewed and have completed their agreed Desktop acceptance in the isolated feature branch. Fast/delayed private replies, upload invitations, document-first/rules uploads, private `/say` editing, public output with prepared-response deletion and editing after restart passed through the actual controller. Android was deliberately not tested at the user's request. The user authorized committing the complete change and pushing it to `main` after acceptance.

## Accepted first-iteration implementation scope

Implement ephemeral slash commands and controller-owned command replies first. Preserve ordinary command behavior where the incoming command is not ephemeral. Include the accepted document-first upload route and controller-registered, one-hour attachment invitations for the command-first route. Preserve permission, argument, chat-type and source validation unless an explicit scope decision below changes it.

Defer all agent-tool changes (`send`, `read`, `edit`, `delete`, history/search and agent events) and ephemeral widget views to a later iteration. This postpones their implementation, not the previously accepted direction. Incoming ephemeral messages that are not recognized commands or valid attachment responses must not enter ordinary saved group history, model queues, widget handling or public listening windows in this iteration. Native ID zero must never be used as an ordinary message address.

The user accepted these implementation details:

1. Keep one-hour invitations in memory; restarting the controller loses them. No database migration is required.
2. Close an invitation after its first successful upload. A failed attempt can be retried until expiry. Concurrent attempts must not both write.
3. Permit `/upload` and `/rules set` in groups with the existing user-role requirements. Other private-only commands retain their restrictions.
4. Show `Processing…` only after five seconds without a command response, then edit that acknowledgement on completion. Fast commands never show it. Commands issuing an attachment invitation never schedule processing; send their invitation as a fresh, unedited message.

Implemented and verified in the existing isolated worktree: command-list registration, command-specific reply transport (including the 15-second response window), invitation dispatch, isolation tests and bounded single-platform file acceptance.

## Controller implementation verification

- Fresh Windows suite with the unchanged Wordle archive: 677 tests, 669 passed, 8 skipped, 0 failed. The opt-in Wordle compatibility and migration tests passed; no Wordle source changes were made.
- Focused response, upload and help suite: 44 passed, 0 failed. Fake-clock coverage checks the five-second timer, fast completion, fresh invitations and delayed edits after the initial response window. Upload tests cover expiry/restart, retry/consumption, concurrency, identity/topic checks and permission revocation.
- Independent review identified expired private responses replaying command side effects and timers surviving router shutdown. Regression tests reproduced both; the fixes make private response failures terminal, reject already-expired input before mutation, and cancel pending response sessions on shutdown/removal. Follow-up review found no remaining Critical or Important issues. An independent polling reproduction confirmed offset advancement without mutation/retry for expired input.
- Fresh Alpine 3.24.2 / Node 24.18.1 suite as the ordinary test user, using the same unchanged Wordle archive: 677 tests, 674 passed, 3 skipped, 0 failed. An initial run as root failed the existing explicit non-root assertion in the deletion-permission test; the complete rerun used the intended ordinary user. Only the exported Linux copy of the existing Git askpass shebang was normalized to LF; tracked application source was unchanged by this export correction.
- Wiki validation passed: 19 articles, 533 local links, 17 JSON examples and 55 controller tools. Whitespace checks and syntax checks for both manual harnesses passed. Existing exclusive-lock regressions passed 2/2.
- The opt-in [actual-controller acceptance harness](../../test/manual/ephemeral-command-acceptance.mjs) uses a new disposable controller database, the explicitly configured test bot and a previously observed group, with an exclusive lock and a maximum 30-minute lifetime. Only the owner's selected command families and attachments reach that controller. It records file sizes and hashes locally, never runs a model, restores six group command lists with read-back, removes only probe-created output and never leaves the group. `/agent models` is delayed 18 seconds to exercise processing at five seconds and editing after the initial native response window. No production database or model session is used.

### Controller live acceptance and cleanup

The bounded actual-controller run started with verified test-bot identity, no webhook, the previously observed supergroup and ordinary bot membership (`member`). Six group command lists were backed up and native ephemeral registration was confirmed by read-back. The user executed the first three requested Desktop cases; the controller journal confirms:

- `/agent status` arrived as ephemeral and completed in 105 ms with one private response and no processing acknowledgement.
- Deliberately delayed `/agent models` arrived as ephemeral. `Processing…` was confirmed approximately 5.26 seconds after admission. `editEphemeralMessageText` replaced that same private message with the result approximately 18.24 seconds after admission, beyond the initial native 15-second response window. Total handler duration was 18.25 seconds. These timings include Telegram API round trips.
- `/upload wiki/invitation.txt` arrived as ephemeral and produced one fresh private invitation in 256 ms. It scheduled no processing acknowledgement and no edit was made to the invitation.
- The first document reply to that invitation arrived as ephemeral with the quoted bot target, saved a 3-byte file through the real controller/file-download path and completed with a private confirmation in 308 ms. The second document reply arrived as ephemeral 25.5 seconds later and was ignored in 10 ms without another output. The file size and SHA-256 remained identical. The user confirmed both outcomes matched expectations, including the absence of a second confirmation.
- `/help` and `/agent invalid` both arrived with native ephemeral IDs and produced private replies in 107 ms and 101 ms respectively. The user saw the visibility icon on the help reply but not on the command itself. The native update still identified that command as ephemeral. In a subsequent check from a second account, the user confirmed the help command was invisible. This supports a Desktop visibility-icon display issue; missing that icon did not mean this command was public. No internal client trace was collected.
- Document-first upload: an ordinary document was followed by an ephemeral `/upload wiki/document-first.txt` quoting that document. The actual controller saved it and privately confirmed `Saved` in 271 ms.
- Rules upload: ephemeral `/rules set` produced a fresh invitation in 100 ms. An ephemeral document reply then saved the rules through the actual controller in 245 ms, privately confirmed the update, and advanced the bot rules version. The three saved files had equal size and SHA-256. The user confirmed both upload scenarios succeeded.
- Eleven selected inputs produced ten successful send/edit calls, including one processing acknowledgement and its edit; there were no controller errors or model calls. Native ephemeral message ID zero was absent from ordinary saved history, independently checked after shutdown.
- The runner was stopped gracefully. All six saved group command lists were restored and verified by read-back, then independently read again after exit. Nine probe-created private outputs were deleted without reported failures, the ordinary update subscription was restored, and the exclusive bot lock was released. The bot remained an ordinary member of the group; no user messages were deleted and no production database was touched.
- One-hour expiry, invitation loss after restart, permission revocation, wrong-user/topic attempts, write-failure retries and concurrent acquisition were covered by automated tests, rather than repeated live. Deferred agent APIs and ephemeral widgets remain outside this iteration.

## Scope

The standalone [probe](../../test/manual/ephemeral-commands.mjs) uses an explicitly configured disposable bot, no model, no controller database, and a maximum 30-minute lifetime. A fresh owner-issued setup command binds exactly one observed group or supergroup. Only the configured owner's fresh test commands are processed.

The probe registers `ephcheck` with `is_ephemeral: true` and `pubcheck` with `is_ephemeral: false` for that chat. It saves and verifies command lists for the default, English, Russian and invoking user's language. The unregistered `ephunknown` is a control. It leaves other chats' command lists unchanged and restores the saved lists on exit. It never leaves a group or changes administrator permissions. Private test receipts are deleted on exit; diagnostic direct messages remain available to the owner.

## Evidence and acceptance

- Before live startup: syntax validation and the two existing lock regression tests passed.
- Live setup: `setMyCommands` / `getMyCommands` confirmed the flags for default, Russian and English chat-specific command lists. The observed chat is a supergroup. The bot initially had administrator privileges; the user subsequently removed them and a separate `getChatMember` read confirmed `member`. No administrator privileges were requested or changed by the probe.
- Desktop: the first bare command and first bare command with arguments arrived as ordinary messages, approximately 44 and 70 seconds after registration completed. The addressed command with arguments arrived as ephemeral approximately 102 seconds after registration. Later bare commands and a bare command with arguments also arrived as ephemeral, starting approximately 191 seconds after registration. The user reports that both command and reply became invisible to others. Delayed client command-list refresh is consistent with these observations, but no client cache trace was collected and no fixed refresh timeout is established.
- The first ten recorded commands comprise three ordinary messages and seven ephemeral messages. All seven immediate ephemeral replies succeeded (99–175 ms API time). Ephemeral requests and replies had `message_id: 0`, `ephemeral_message_id` and `receiver_user`; ordinary commands had positive `message_id` and neither ephemeral field.
- The first two commands did reach the bot. The probe deliberately sent no group reply for an ordinary command and reported its classification in the owner's private chat; absence of a group receipt was not a bot delivery failure.
- Desktop after removing administrator privileges: the addressed command with arguments, the bare command with arguments, and the addressed command without arguments all arrived as ephemeral. All three immediate replies succeeded (100–161 ms API time). The user confirmed all requested cases, including selecting the command from the menu; the menu action itself is not distinguishable from equivalent manually entered text in the received update.
- Android and other platforms were not tested; the user accepted one platform as sufficient for this experiment.
- Controls: `/pubcheck@BOT_USERNAME` arrived as an ordinary message, as intended. The unregistered command was not exercised before the experiment ended.
- Client acceptance uses Telegram's native visibility labels: the user observed `only visible for @bot` on commands and `only visible to you` on replies. At the user's request, a second-account observation is not required for subsequent cases. This is client UI evidence combined with native ephemeral fields, not an independently repeated cross-account privacy check.
- For sent ephemeral messages, the user reports that the Desktop client offers Forward and Delete, but no reactions or Reply action. This observation is scoped to sent messages. Received bot messages were tested separately below; actual forwarding outcomes were not tested. The missing client Reply action for sent messages does not contradict the seven successful programmatic bot replies through `reply_parameters.ephemeral_message_id`.
- The local private report records native message fields, identifiers, receipt outcome and timing. Only fresh matched test commands are retained; no unrelated group history is logged.
- Immediate ephemeral responses use `ephemeral_message_parameters.receiver_user_id` and `reply_parameters.ephemeral_message_id`. If the command arrives as ordinary, the probe reports that fact privately and does not send a public substitute.
- Production handling, delayed responses, expiration, editing and widget integration are outside this first experiment.

## Completion and cleanup

The runner was stopped after checking its process identity. Cleanup restored and independently read back all three saved chat-specific command lists (default, Russian and English), deleted the seven probe-created ephemeral replies, restored the controller's ordinary update subscription inventory, and released the shared test-bot lock. All cleanup API calls succeeded. No group was left, no user command was deleted, and no production behavior was changed. Diagnostic direct messages remain available to the owner.

Syntax validation, the two existing lock regressions, wiki link/example validation, and whitespace checks passed. This is transport and client evidence, not an implementation of ephemeral command handling in the controller.

## References

- [Telegram ephemeral messages and commands](https://core.telegram.org/bots/api#ephemeral-messages-and-commands)
- [BotCommand](https://core.telegram.org/bots/api#botcommand)
- [setMyCommands](https://core.telegram.org/bots/api#setmycommands)
- [EphemeralMessageParameters](https://core.telegram.org/bots/api#ephemeralmessageparameters)

The current project wiki continues to describe the unchanged controller. Experiment outcomes belong here until an implementation is agreed.

## User reply to a received bot message

Follow-up status: passed on Desktop in the same explicitly selected supergroup, with the bot confirmed as an ordinary member. The received bot message offered Forward, Reply and Delete. The user successfully selected Reply; Telegram displayed the resulting user message as private.

The native update confirmed all of the following:

- The user's reply was delivered to the bot with `message_id: 0`, its own `ephemeral_message_id`, and `receiver_user`.
- `reply_to_message` was present, contained the bot's message, and had `message_id: 0` and the exact `ephemeral_message_id` previously returned for the bot's private reply.
- The probe matched this target to the bot receipt it had sent; `external_reply` was absent. This was a real reply relationship, not just standalone text containing the test marker.
- The update arrived approximately 36 seconds after the bot message's successful send response. This establishes that this user reply was possible beyond 15 seconds; it does not establish an unlimited lifetime or change the documented time limit for programmatic bot replies.

The probe uses a unique marker and records matching attempts even if Telegram omits a reply relationship. Native fields are retained only in the private report; unrelated group messages are not logged. Two fresh commands produced two ephemeral bot replies during the run. On completion, graceful cleanup restored the three saved command lists, deleted those two bot receipts without reported errors, restored the ordinary update inventory and released the shared bot lock. The bot remained in the group.

The runner also accepts an operator-created local stop file for graceful cleanup without requiring the user to send another Telegram command. This follow-up does not alter the first run's completed results.

## Accepted upload compatibility requirement

Preserve the existing document-first form: the user sends a document, then sends `/upload PATH` as a reply to that document. The command can be ephemeral; the source document remains an ordinary group message. Existing ownership, same-chat and unedited-source checks must remain enforced. This decision preserves an existing upload route and does not introduce a bot invitation as a prerequisite for it. The command-first route is a separate question, not removed by this decision.

This is an accepted requirement for future controller support. The existing syntax was checked against [the command reference](../commands.md#files-and-git) and the file handler, but an ephemeral upload command replying to a document has not yet been exercised live.

## Accepted command-first upload with a short-lived invitation

The stateless pre-block proposal was rejected: an agent can also produce bot messages, so bot authorship and a command-looking pre block do not establish that the user issued an upload or `/rules set` command.

Implemented behavior:

- A validated user command that requires an attachment produces a controller-owned invitation. Its wording and formatting are unrestricted; the text is never parsed as authorization.
- Save a short-lived association between the invitation's confirmed `ephemeral_message_id` and the original command. The lifetime is one hour. Only the validated controller-command path creates such an association; arbitrary agent output cannot register one.
- When a document arrives as a reply, resolve the invitation and execute the stored operation and parsed arguments. Preserve the current command's allowed chat types, user permissions, filesystem restrictions and edit/source validation; recheck permissions when processing the attachment.
- Once the association expires or is absent, the attachment does not execute a controller command. Never reconstruct an expired or missing command from the invitation text.
- Preserve the separately accepted document-first upload route above.

Implemented identity and response safeguards:

- Scope the association by bot, chat, topic and intended user in addition to the ephemeral ID; retain the parsed operation, arguments and expiry. Telegram permits an ephemeral ID to be reused after deletion or expiry, so also verify the quoted message's creation date and content fingerprint against the confirmed invitation rather than relying on an ID match alone.
- Register only after a confirmed successful invitation send. Missing reply target fields must prevent command execution; storing the command does not by itself recover a target omitted by Telegram.
- For a slow accepted upload, acknowledge after five seconds without a response and edit that acknowledgement on completion. Invitation commands disable the timer and always send a fresh prompt.

Implemented lifecycle: invitations live in memory, are lost on restart, expire after one hour and close after the first successful upload. Failed transfers permit retry before expiry; simultaneous attempts are serialized by invitation. Actual Telegram attachment replies and successful invitation consumption passed through the controller in Desktop acceptance.

References: [Message, optional ephemeral reply context and ID reuse](https://core.telegram.org/bots/api#message), [response window](https://core.telegram.org/bots/api#ephemeral-messages-and-commands), [ephemeral text edits](https://core.telegram.org/bots/api#editephemeralmessagetext).

## `/say`: accepted next-iteration design

Implemented after the completed ephemeral-controller-command iteration above, in the same isolated feature branch. The current interface is documented in [hidden correspondence](../ephemeral.md). Automated validation, independent review and live `/say` acceptance are recorded below.

- Register `/say MESSAGE` as an ephemeral command that addresses the current chat's existing agent through its ordinary queue and shared context. Require this bot's application role `user` or higher (`user`, `manager`, `admin`, `owner`), including in groups. This is the explicit `/say` access rule; it does not loosen other controller-command role requirements. A disabled chat agent is not enabled by `/say`.
- Treat the content as an ordinary user message of that chat, with the same author and instruction authority. Ephemeral delivery confers no extra permissions, trust, priority or queue capacity. It is hidden correspondence with the same chat agent, not a separate personal agent/session. Existing shared-context information handling remains applicable.
- Remove the command prefix from the delivered text and adjust remaining formatting offsets. Include `triggers:["/say"]` and `ephemeralMessageId` for native ephemeral input; omit the redundant `ephemeral:true` flag. Never treat native ordinary ID zero as a usable ordinary message address or invent an ephemeral ID for ordinary input.
- Do not open a public listening window or put this private input into ordinary group history. Implemented storage uses separate agent-owned snapshots in SQLite migration 18 with a 30-day local TTL and explicit private read addresses.
- The agent may respond privately or publicly according to the user's request. Hidden input alone does not force hidden output.
- Telegram permits a direct reply using `reply_parameters.ephemeral_message_id`, but that reply must itself be ephemeral and sent within 15 seconds of the source message. Public output must be a separate message without that reply target. Chat administrators may send separate unsolicited ephemeral messages after that window; the direct-reply deadline still applies.
- Prepare an ephemeral bot response immediately for `/say` so that the agent may edit it after waiting in the ordinary queue. This is specific to `/say`; the completed controller-command iteration retains its five-second delayed processing policy and immutable file invitations. The accepted event/response shape below is implemented.
- Extend the agent's `send` interface to support `reply_parameters.ephemeral_message_id` and the required private destination, with a distinct send result/address. A direct reply remains subject to Telegram's initial window; editing the prepared response avoids relying on a fresh late reply.
- Let Telegram decide whether a private send/reply is still permitted and return its rejection to the agent as a tool error. Do not automatically remove the reply target, retry publicly, or publish a controller error to the group. Instruct the agent to remain silent after an expired/unavailable private-response error rather than expose the hidden exchange through an error announcement.
- Clarification against the user's suggested administrator case: Telegram's documented 15-second restriction is on the direct ephemeral reply itself. Administrator status allows a separate hidden send without a reply target after that deadline. Late direct replies by an administrator have not been live-tested; do not promise that administrator status bypasses the direct-reply deadline or add a controller-side rule that exceeds Telegram's actual constraints.

Reference: [native reply constraints](https://core.telegram.org/bots/api#replyparameters), [ephemeral response permissions](https://core.telegram.org/bots/api#ephemeral-messages-and-commands). Direct late administrator replies remain documentation-verified only; `/say` prepared-response editing was live-tested as an ordinary bot member.

Accepted event envelope: keep `eventType:"message"`, the existing short content/from/date/topic fields, `triggers:["/say"]` and the incoming `ephemeralMessageId`. Add `preparedReply:{ephemeralMessageId,receiverUserId}` for a confirmed controller-owned bot response in the originating chat. The two IDs refer to different messages; neither is represented by ordinary ID zero. Extend `edit` to accept that address, allowing `edit({...event.preparedReply,text:"..."})`; deletion uses the same ephemeral address. For public output the agent uses ordinary `send`; it may delete an unused prepared response. If no answer is needed it may also delete that response. The controller must preserve internal ownership/generation validation rather than trusting a supplied ID. On failed or uncertain preparation, still deliver the user event without a confirmed `preparedReply` and include the preparation error. The neutral initial response text is `Request received.`.

### `/say` implementation verification

- SQLite migration 18 introduces separate private snapshots, preparation state and admission markers. Reads require the originating bot/chat/agent; known address reuse is quarantined, and ordinary history/search never receive native ID zero. The local TTL is the standard 30 days. Current supported behavior is described in [hidden correspondence](../ephemeral.md).
- RED/GREEN coverage includes private tool delivery, source/recipient ownership, denied selector combinations, user-role admission, disabled/full queues, duplicate updates, preparation failure, role revocation, shutdown, public send/deletion, private-failure suppression, persisted prepared-response editing, source forum topic and full reads of a 1,002-emoji input with truncated short events.
- Independent review found nested content fields overriding private send routing and concurrent edits bypassing uncertain-delivery protection. Regressions reproduced both before fixes. Native nested-field allowlists, per-address edit/delete serialization and immediate source/uncertainty rechecks resolved them. Follow-up review found no remaining Critical or Important findings; 22 focused tests passed.
- Fresh full Windows suite: 699 tests, 691 passed, 8 skipped, 0 failed. Fresh full Alpine suite as the ordinary test user: 699 tests, 696 passed, 3 skipped, 0 failed. Both used the unchanged Wordle archive. Final wiki validation: 20 articles, 555 links, 18 JSON examples and 55 controller tools. Whitespace and manual-harness syntax checks passed.
- The opt-in [say acceptance entrypoint](../../test/manual/say-ephemeral-acceptance.mjs) reuses the bounded actual-controller harness with a deterministic agent, real Telegram, the ordinary chat queue and tools. It uses a new disposable database, grants the actor only application role `user`, verifies ordinary bot membership, backs up and verifies six group command lists, and requires an explicit completed group probe plus an exclusive bot lock. It does not call a model. Its three cases are delayed private edit after 18 seconds, public send plus private-response deletion, and editing a stored prepared response after controller/database restart. No automatic group leave or production database modification occurs.
- Desktop `/say` live cases 1/2 passed and were confirmed by the user. Both commands arrived as ephemeral. The first prepared response was confirmed about 116 ms after input and edited in place about 18.37 seconds after input, beyond the initial reply window; handler completion was 18.40 seconds. The second prepared response appeared in about 91 ms, then the ordinary public send succeeded and the private prepared response was deleted; handler completion was 692 ms. The native bot was an ordinary member and the actor had only app role `user`. Full hidden-input reads also succeeded through the actual tool route.
- Desktop restart case passed and was confirmed by the user. The third ephemeral `/say` prepared a private response in about 132 ms, then deliberately left it unchanged. A private harness control closed the controller and database and opened fresh instances on the same SQLite file. The stored response was read through the new controller and successfully edited about 22.3 seconds after the original input. No source event was replayed; the three group commands produced exactly three deterministic agent runs, with no model calls or controller errors. Ordinary saved history contained no message ID zero.
- Cleanup completed normally: all six saved group command lists were restored and read back, then independently read back after exit. Remaining probe-created bot outputs were deleted, the ordinary update inventory was restored, and the shared bot lock was released. The bot stayed an ordinary member; no user messages or production data were removed.
- Scope of evidence: live tests use deterministic handlers with the real controller, queue, SQLite and Telegram tools, not a model provider. Formatting, long content, role revocation, concurrency, expiry and known ID reuse are asserted by automated tests; this live run used short plain text. Private media and interactive private buttons/widgets were not live-tested; the latter remain explicitly unsupported.

## Agent-authored ephemeral output: accepted direction and API proposals

Partially implemented by `/say`: agent `send`, `read`, `edit` and `delete` now have explicit private routes using the existing chat agent/context. The earlier direction was to default to private output for ephemeral replies; the subsequently accepted `/say` design allows public or private output according to the user's request. The detailed broader proposals below are retained for future work; [current supported fields and limitations](../ephemeral.md) are authoritative. Interactive private buttons, widgets and general delivery of non-command private events are deferred.

Proposed `send` extension: native `ephemeral_message_parameters`, keeping ordinary content fields, uploads, formatting and supported buttons. This fits the current convention of camel-case controller addresses and native nested Telegram objects. Existing bot/chat publication permissions remain applicable; specifying a recipient does not grant access to another chat, another agent's destination or private history.

Examples of the proposed shape:

```javascript
await send({
  text: "Your personal hint",
  ephemeral_message_parameters: {receiver_user_id: 123456}
});
await send({
  text: "Private reply",
  ephemeral_message_parameters: {receiver_user_id: 123456},
  reply_parameters: {ephemeral_message_id: 789}
});
```

The first form requires the Telegram permissions for unsolicited ephemeral output (chat administrator). A non-administrator needs a recent qualifying ephemeral message or callback; the documented window is 15 seconds. Return an explicit failure when that route is unavailable or expired. Never silently substitute a public group message. Telegram does not guarantee ephemeral delivery, especially to offline users.

An ephemeral send needs a distinct result/address, proposed as `{ephemeralMessageId,receiverUserId}`, rather than exposing `messageIds:[0]`. This also affects read/edit/delete, persistence, callback handling and incoming user replies. Unsupported native content types remain explicit errors; guest/inline publication does not become an ephemeral ordinary-chat send.

Agent output never creates a pending controller-command invitation. Only the validated command handler registers the accepted one-hour upload association.

The accepted shared-context choice means that hiding a message in Telegram does not separate the agent's model context. Instructions must describe the private audience and prevent accidental publication of private input. Incoming private replies need an explicit route/author association and the accepted private-reply default.

### Proposed remaining API changes

| Surface | Proposed change |
|---|---|
| Address and send result | Use `ephemeralMessageId` plus `receiverUserId` and chat scope; ordinary, inline, guest and ephemeral selectors are mutually exclusive. Do not expose `messageIds:[0]` as a usable address. Telegram ID reuse requires internal generation validation rather than assuming global or permanent uniqueness. |
| `read` | Accept the ephemeral address, return the saved native message with the existing `messages` wrapper and formatting/file metadata. Missing or expired local records are explicit errors; local availability does not guarantee client visibility. |
| `edit`, `delete` | Accept the same address and call native ephemeral text/rich/media/caption/keyboard edit or delete methods, preserving ownership checks. Do not accidentally run ordinary edits or deletes against ID zero. |
| Message and button events | Add the ephemeral address, recipient and an unambiguous private-visibility indicator, plus a reply target when present. Expose the known response deadline/capability so a queued model turn can tell whether a fresh reply is still possible. Keep raw callback acknowledgement in the controller. |
| Reply routing | For private input, keep omission of addressing private to that user in the originating chat. Existing public sends from public events retain their defaults. Batched events with conflicting audiences require explicit selection rather than guessing. Private interactions must not open a public listening window. |
| `history`, `search` | Return ephemeral visibility/address fields, allow explicit visibility/recipient filters and keep private records out of other agents' ordinary cross-chat reads. Their local retention policy must be explicit and separate from the accepted one-hour pending-upload association. |
| Buttons | Preserve current permits, groups and acknowledgements with message keys that include ephemeral scope. Button events keep the private route; grouped-button edits use ephemeral methods. The controller resolves the recent callback capability for an ephemeral response. |
| Errors and unsupported actions | Give actionable expired/unavailable/content errors; preserve delivery uncertainty and do not substitute public delivery. Do not expose ordinary pin/react/forward/copy operations as if ID zero were a normal message ID. |

Optional next scope, not accepted: add ephemeral destinations to `set_widget_view` for private widgets. This requires the same address in returned targets, rendering, event routing and detach handling. Widget support is not necessary for agent-authored text/media or private replies.
