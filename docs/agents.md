# Agents

An agent belongs to one chat of one bot. Its record persists independently of whether a Codex process is currently running. Controller [commands](commands.md) manage the enabled state, context, model, and rules.

## Instructions and context

The controller supplies `developerInstructions` when starting or resuming an agent's thread. They contain service rules, the bot's configured AGENTS.md, bot profile data, current chat data, agent identity, and the default time zone. Supplying updated instructions on resume does not guarantee that Codex replaces a saved thread's instructions: the tested 0.159.3 runtime retained the old instructions. Use a fresh context for rules/instruction replacement. Rules files are stored outside the shared wiki so agents cannot change their governing rules by editing files.

Service instructions tell agents to call `user_roles` when authorization depends on a user's current application role, rather than trusting remembered or previously returned roles. If a role is irrelevant to the action, no query is needed. Application roles are distinct from Telegram chat administrator status and are not automatically included in incoming events. See [Agent contract](agent-contract.md) for the batch query and its validation rules. Existing saved contexts may need `/agent clear` to receive updated service instructions.

Service instructions explain publishing through `send`, private-history confidentiality, authenticated interagent envelopes, vault handling, media reuse, reply reads, and delivery reasons. They take precedence over bot rules and untrusted message/page/file content. `baseInstructions` is not replaced by the application; Codex retains its own runtime instructions. The controller supplies instructions separately from ordinary event history. Runtime probes confirmed that a simple developer-instruction marker survived explicit compaction on Codex 0.159.3; they did not prove perfect adherence to every rule in an arbitrary AGENTS.md or every future runtime. See the [runtime](dev/archive/runtime-check-results.md) and [Alpine](dev/archive/alpine-check-results.md) reports for the tested scope.

Changing rules or explicitly clearing context creates a fresh thread with current instructions. It waits for active root work, subagents, and controller operations, while new events wait behind the reset. The controller clears the saved thread reference and asks Codex to delete the owned session records. Notes, stored Telegram history, model settings, tasks, and shared files remain. `/agent stop` also discards queued chat events; `/agent clear` preserves the queue.

## Activation in groups

An enabled group agent is directly triggered by:

- A Telegram mention entity for this bot's username.
- A reply to a message whose sender is this bot.
- A configured literal trigger phrase matched in text or caption.
- An accepted callback button press.

Custom phrases are case insensitive. Neither adjacent character may be a Unicode letter; digits, punctuation, and underscores do not block a match. Trigger strings contain 2–50 Unicode code points, with at most 200 configured per chat. Internal spacing is literal; `e` and accented letters, or `е` and `ё`, are distinct. Automatic channel forwards do not activate custom phrase matching.

Each direct trigger enables loud mode for two minutes and up to ten subsequent admitted messages. Another trigger restarts both allowances. An album counts as one chat event. Untriggered events admitted only by loud mode may expire before dispatch when the time window ends. Loud mode does not mean every message addresses the bot; deciding whether to answer remains the agent's responsibility.

Incoming short events explain direct causes using optional `triggers`, such as `mention:@example_bot`, `reply`, and `match:Rick`. Loud-only and private-chat events omit it. A `historyGap: true` hint means the controller observed group messages that were not delivered; the agent can consult history when needed. See [message events](message-events.md).

## Queues and availability

The ordinary queue holds at most ten chat entries, including callbacks and collected albums. Already dispatched work does not occupy a waiting slot. Scheduler, interagent, and WebSocket notifications do not count toward that limit. A full queue rejects a callback immediately; dropped messages remain available in saved history if otherwise retained.

The root agent receives a batch when idle. During a recognized root wait for subagents, the controller may steer new events into the active turn. Waiting for a shell command is not automatically the same as the recognized subagent wait. Active image generation alone does not guarantee immediate processing of new input; root availability determines it.

| Observed activity | Telegram action |
|---|---|
| Root working | `typing` |
| Root not working, image generation active | `upload_photo` |
| Root idle or waiting, no active image generation | None |

The controller refreshes actions every four seconds. Pending subagents still matter for task completion and context maintenance even if no action is displayed. A root turn ending with children active can free the ordinary queue before the whole work unit settles.

## Models and enabled state

Models are per agent. The bot's default is copied when creating new agents; changing the default does not change existing records. Administrator model changes apply to subsequent turns, not an already running turn. Available models come from the active Codex runtime; only admin/owner may inspect or modify them.

Stopping an agent leaves the bot in the chat and keeps recording history. The active work finishes, its context is deleted, and future events are withheld. Notes, model, triggers, history, files, and tasks remain. Missed task occurrences accumulate with `missedReason: "agent_disabled"` and are offered after restart. Starting while a stop is still completing is refused; repeated completed starts/stops are safe.

Removing a bot from a chat or using `/chat leave` is destructive for that chat: agent, context, notes, tasks, history, and temporary files are removed. Shared permanent files remain. A basic-group migration to a supergroup instead preserves the chat data and enabled state under the new chat ID.

## Coordination

`agent_message` asynchronously queues a message to another enabled agent of the same bot. There is no automatic delivery receipt or guaranteed reply. The recipient may explicitly reply to `from.agentId`. Private senders expose agent identity without their private chat ID; public-chat senders also include chat ID. Delegation does not grant access to unrelated private history or notes. See [security](security.md) and the [agent contract](agent-contract.md).
