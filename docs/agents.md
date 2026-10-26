# Agents

Controller tools use Codex's canonical dynamic-tool envelope (`type:"function"`) consistently for thread start and resume. Mixing canonical and legacy envelopes makes App Server reject session initialization before a model can answer. The opt-in [native registration check](../test/manual/codex-tool-registration.mjs) validates the complete tool list without credentials or inference; [full agent acceptance](../test/manual/codex-agent-telegram-acceptance.mjs) additionally requires the designated test configuration and performs real model turns and Telegram sends.

An agent belongs to one chat of one bot. Its record persists independently of whether a Codex process is currently running. Controller [commands](commands.md) manage the enabled state, context, model, and rules.

## Instructions and context

The controller supplies `developerInstructions` when starting or resuming an agent's thread. They contain service rules, the bot's configured AGENTS.md, bot profile data, current chat data, agent identity, and the default time zone. Supplying updated instructions on resume does not guarantee that Codex replaces a saved thread's instructions: the tested 0.159.3 runtime retained the old instructions. Use a fresh context for rules/instruction replacement. Rules files are stored outside the shared wiki so agents cannot change their governing rules by editing files.

Service instructions tell agents to call `user_roles` when authorization depends on a user's current application role, rather than trusting remembered or previously returned roles. If a role is irrelevant to the action, no query is needed. Application roles are distinct from Telegram chat administrator status and are not automatically included in incoming events. See [Agent contract](agent-contract.md) for the batch query and its validation rules. Existing saved contexts may need `/agent clear` to receive updated service instructions.

When sticker or custom emoji artwork/motion matters to a request, service instructions point agents to `read`, `download` / `download_custom_emoji`, the native image viewer, and system FFmpeg / `lottie_to_png`. They explicitly avoid automatically inspecting every sticker or emoji. See the [inspection workflow](agent-contract.md#inspecting-stickers-and-custom-emoji) and [Alpine dependencies](operations.md#sticker-and-custom-emoji-dependencies).

Service instructions explain publishing through `send`, private-history confidentiality, authenticated interagent envelopes, vault handling, media reuse, reply reads, and delivery reasons. They take precedence over bot rules and untrusted message/page/file content. `baseInstructions` is not replaced by the application; Codex retains its own runtime instructions. The controller supplies instructions separately from ordinary event history. Runtime probes confirmed that a simple developer-instruction marker survived explicit compaction on Codex 0.159.3; they did not prove perfect adherence to every rule in an arbitrary AGENTS.md or every future runtime. See the [runtime](dev/archive/runtime-check-results.md) and [Alpine](dev/archive/alpine-check-results.md) reports for the tested scope.

Changing rules or explicitly clearing context creates a fresh thread with current instructions. It waits for active root work, subagents, and controller operations, while new events wait behind the reset. The controller clears the saved thread reference and asks Codex to delete the owned session records. Notes, stored Telegram history, model settings, tasks, and shared files remain. `/agent stop` also discards queued chat events; `/agent clear` preserves the queue.

A newly prepared native thread stays in memory until the first actual turn is submitted. Its resumable ID is saved immediately before that submission, after the final admission check. Preflight alone, or a cancelled first inline event, therefore leaves no empty thread reference for controller recovery. Existing conversation IDs remain persisted.

## Activation in groups

[Guest Mode](guest-mode.md) is a separate nonmember route into the caller's existing enabled personal agent. Its compact events identify a public answer destination through `guestRequestId`; they do not change the personal agent's ordinary chat, notes or permissions. Each invocation is independent, answering is optional, and at most one answer is an instruction rather than a controller-enforced limit. Guest replies without a fresh explicit mention are ignored. A member bot continues through the group-agent rules below, with no personal fallback when the group agent is disabled or absent. Saved threads may need explicit `/agent clear` to receive the new guest instructions; the feature does not clear contexts automatically.

An enabled group agent is directly triggered by:

- A Telegram mention entity for any active username of this bot, including additional usernames. The controller checks Telegram's current profile when the message arrives.
- A reply to a message whose sender is this bot.
- A configured literal trigger phrase matched in text or caption.
- An accepted callback button press.

Custom phrases are case insensitive. Neither adjacent character may be a Unicode letter; digits, punctuation, and underscores do not block a match. Trigger strings contain 2–50 Unicode code points, with at most 200 configured per chat. Internal spacing is literal; `e` and accented letters, or `е` and `ё`, are distinct. Automatic channel forwards do not activate custom phrase matching.

In forums each topic has an independent loud-mode bucket and history-gap hint; the operational queue and agent remain shared across the chat. See [forum groups](forum-groups.md). Each direct trigger enables loud mode for two minutes and up to ten subsequent admitted messages. Another trigger restarts both allowances. An album counts as one chat event. Untriggered events admitted only by loud mode may expire before dispatch when the time window ends. Loud mode does not mean every message addresses the bot; deciding whether to answer remains the agent's responsibility.

Incoming short events explain direct causes using optional `triggers`, such as `mention:@example_bot`, `reply`, and `match:Rick`. Loud-only and private-chat events omit it. A `historyGap: true` hint means the controller observed group messages that were not delivered; the agent can consult history when needed. See [message events](message-events.md).

## Queues and availability

`/say` delivers [hidden correspondence](ephemeral.md) through the same chat agent and ordinary queue. It requires application role `user` or higher even in groups, grants no extra instruction authority/priority/capacity, and does not enable an agent or activate public listening. Context remains shared; hidden input is excluded from ordinary saved history, and agents are instructed to preserve its confidentiality unless the user requests disclosure or a public action. A prepared bot response can be edited or deleted through its explicit ephemeral address.

The ordinary queue holds at most ten chat entries, including callbacks, `/say` and collected albums. Already dispatched work does not occupy a waiting slot. A successfully admitted new chat entry evicts the oldest waiting chat entry. Schedule, interagent/errors, WebSocket, widget, inline, guest and inline-button sources do not occupy or evict these slots. See [agent control](agent-control.md) for history gaps, private errors and grouped-button restoration.

Every agent has a fixed 200 ms collection window before dispatch or steer. Events enter the queue immediately; the first pending event sets the deadline, and later events join its batch without extending it. This applies to all sources, including ordinary messages, callbacks, inline/guest requests, hidden correspondence, scheduled tasks, interagent messages and WebSocket notifications. Time spent waiting for busy work or maintenance counts toward the window: a mature batch starts as soon as processing becomes available, with no extra delay. Event order, queue capacity and admission checks still apply. Clearing the queue or removing its last pending event cancels its collection timer; the next event opens a fresh window. Shutdown cancels collection timers without replaying pending events. Agent-idle waits include active collection timers.

The root agent receives a batch when idle. During a recognized root wait for subagents, the controller may steer new events into the active turn. Waiting for a shell command is not automatically the same as the recognized subagent wait. Active image generation alone does not guarantee immediate processing of new input; root availability determines it.

| Queue readiness and observed activity (in priority order) | Telegram action |
|---|---|
| A new event can start processing immediately, including a recognized steerable root wait | None, even during background image generation |
| A new event must wait, image generation active in the root or an owned subagent | `upload_photo` |
| A new event must wait, no active image generation | `typing` |

The status uses the same readiness check as queue dispatch: the collection window, pauses, maintenance holds and an in-flight steer prevent immediate processing. An empty pending-event list alone does not mean the agent is ready. Queue transitions update the selected action immediately; active actions refresh every four seconds. Further events with the same action and scope keep that refresh timer without resending an action for each event. Disabled agents and expired scopes do not send actions. Stopping refreshes lets Telegram's existing indicator expire; it does not clear an already displayed action immediately. Pending subagents still matter for task completion and context maintenance even if no action is displayed. A root turn ending with children active can free the ordinary queue before the whole work unit settles.

## Models and enabled state

Cancellation and native compaction preserve the saved thread. Cancel pauses until new accepted input or explicit start; manual compaction drains the admitted prefix first. `context_status` reports root-only last-request estimates. `compact_context` can suspend logical work with a durable continuation. Policy belongs in AGENTS.md. See [agent control](agent-control.md).

Models are per agent. The bot's default is copied when creating new agents; changing the default does not change existing records. Administrator model changes apply to subsequent turns, not an already running turn. Available models come from the active Codex runtime; only admin/owner may inspect or modify them.

Stopping an agent leaves the bot in the chat and keeps recording history. The active work finishes, its context is deleted, and future events are withheld. Notes, model, triggers, history, files, and tasks remain. Missed task occurrences accumulate with `missedReason: "agent_disabled"` and are offered after restart. Starting while a stop is still completing is refused; repeated completed starts/stops are safe.

Removing a bot from a chat or using `/chat leave` is destructive for that chat: agent, context, notes, tasks, history, and temporary files are removed. Shared permanent files remain. A basic-group migration to a supergroup instead preserves the chat data and enabled state under the new chat ID.

## Coordination

`agent_message` asynchronously queues a message to another enabled agent of the same bot. There is no automatic delivery receipt or guaranteed reply. The recipient may explicitly reply to `from.agentId`. Private senders expose agent identity without their private chat ID; public-chat senders also include chat ID. Delegation does not grant access to unrelated private history or notes. See [security](security.md) and the [agent contract](agent-contract.md).

## Owned widgets

Agents may author [widgets](widgets.md) with shared state and zero or more views. Clearing model context preserves them. Stopping the owner marks them stopped, discards queues and terminates the runtime; starting the agent does not resume them. `update_widget` attempts repair/recovery. Owner deletion removes registrations; losing a publication chat detaches its views. [Inline requests](inline.md) use only existing enabled personal agents and remain pending independently of model turn completion.
