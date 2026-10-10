# Child bot commands

[Wiki home](index.md) · [Master bot](master-bot.md) · [Operations](operations.md)

These commands control the child bot receiving the message. Roles belong to that bot and inherit permissions: `user` → `manager` → `admin` → `owner`. Telegram chat administrators do not automatically receive application roles. Unauthorized private messages are ignored. Channels do not execute these commands. For chat routing and supported chat types, see [Channels and discussions](channels-and-discussions.md).

In the tables, **local** means `user` or higher in a private chat and `manager` or higher in a group/supergroup. **Admin** means `admin` or `owner`. Explicit targets require Admin even when they identify the current chat. Commands cannot select another bot's data.

## Syntax, formatting and help

Optional arguments appear in brackets; uppercase names are placeholders. Commands may use the Telegram suffix `/command@BotName`; a suffix naming another bot is ignored. Ordinary whitespace, including newlines, separates arguments. Telegram inline `code` and `spoiler` entities preserve their contents as one argument; a `pre` entity preserves a multiline argument. Entity boundaries also separate arguments. Quotes alone do not group words. Other styling, overlapping entities, and formatting over the command name are rejected. Pre blocks are accepted only for `/edit`, `/git sync`, the instructions argument of `/rules set`, and the TOML argument of `/mcp set`. Send actual Telegram formatted entities: literal Markdown fence characters alone do not create a pre block.

`RANGE` is a positive one-based position `N` or inclusive `FROM-TO`, for example `11-20`. The default is positions 1–10. Filters apply before pagination. Lists show `FROM-TO / TOTAL` or an empty-result message. Long formatted output may be truncated; it is not automatically attached as a file. Responses and errors reply to the command. Syntax errors offer the relevant help section where recognized. Commands are handled by the controller without a model turn; command text is not ordinary agent history.

| Command | Result |
|---|---|
| `/help` | Argument-formatting guide and an index of available sections with descriptions |
| `/help SECTION` | One available section: `agent`, `task`, `chat`, `triggers`, `ws`, `mcp`, `vault`, `user`, `owner`, `rules`, `git`, `file`, or `temp` |

Help is in English and follows role and chat restrictions; an unavailable or unknown section is an error. `/help SECTION` explains each available command's effects, targets, defaults, permissions and retained/deleted data. Command syntax uses code entities. Long help is sent as multiple replies, split between entries without truncation. `/help user` also explains all four roles and their inherited permissions, distinct from Telegram administrator rights. Master help is documented on [Master bot](master-bot.md).

## Agent lifecycle

| Command | Access | Result |
|---|---|---|
| `/agent`, `/agent status` | Local | Current chat status |
| `/agent status AGENT_ID`, `/agent status in CHAT_ID` | Admin | Selected agent/chat status, including a chat without an agent |
| `/agent start` | Local | Enable the current chat's agent |
| `/agent start in CHAT_ID` | Admin | Enable a connected chat's agent |
| `/agent stop`, `/agent clear` | Local | Stop or reset the current agent |
| `/agent stop AGENT_ID`, `/agent clear AGENT_ID` | Admin | Stop or reset the selected agent |
| `/agent stop in CHAT_ID`, `/agent clear in CHAT_ID` | Admin | Stop or reset the selected chat's agent |
| `/agent stop *`, `/agent clear *` | Admin | Stop or reset all existing agents of this bot |
| `/agent list [RANGE]` | Admin | List agents, oldest first, including disabled agents |

Start accepts the current chat or `in CHAT_ID`, not an agent ID or `*`. A target after `in` is required. New groups/supergroups are passive; their received history is stored while the agent is disabled. An authorized first private conversation may enable its agent automatically; an explicit stop requires `/agent start` to resume.

Stop disables triggers and loud mode, drops the pending operational queue, and waits for active work, including subagents, before removing the context. Scheduled items removed from the queue are recorded as missed with `agent_disabled`. Agent identity, model, notes, history, tasks, and shared wiki/Git remain. Start does not interrupt an in-progress stop. Clear waits for active work, resets context and instructions, retains the queue, and does not change enabled state. See [Agents](agents.md), [Message events](message-events.md), and [Scheduler](scheduler.md).

Status shows agent ID when present, enabled mode, execution state and queue size; only Admin sees the model. Agent lists format agent IDs as code and chat types/group IDs as italic text. They show username or title and enabled mode without exposing other private chat IDs.

## Model selection

All forms require Admin. A selected chat must already have an agent.

| Command | Result |
|---|---|
| `/agent model [AGENT_ID]`, `/agent model in CHAT_ID` | Current or selected model |
| `/agent model default` | Default for new agents |
| `/agent model set MODEL_NAME` | Change the current agent |
| `/agent model set AGENT_ID MODEL_NAME`, `/agent model set in CHAT_ID MODEL_NAME` | Change a selected agent |
| `/agent model set * MODEL_NAME` | Change all existing agents, including disabled ones |
| `/agent model set default MODEL_NAME` | Change only the default for new agents |
| `/agent models` | Available runtime model names |

The model must appear in the runtime catalog. Changes apply next turn without interrupting work or clearing context. Changing existing agents does not change the default; changing the default does not update existing agents. See [Agent contract](agent-contract.md).

## Inter-agent message log

All forms require Admin. The default selects the current chat; records are newest first, so the default page contains its newest 10 records. Retention is seven days.

```text
/agent messages [RANGE]
/agent messages [RANGE] agent AGENT_ID
/agent messages [RANGE] from agent AGENT_ID
/agent messages [RANGE] to agent AGENT_ID
/agent messages [RANGE] chat CHAT_ID
/agent messages [RANGE] from chat CHAT_ID
/agent messages [RANGE] to chat CHAT_ID
```

Use one filter. `from`/`to` select sender/recipient, independent of where the command is invoked. Without direction, both incoming and outgoing records match. Entries show `FROM_AGENT → TO_AGENT`, ISO date/time and message text. Long output is truncated. A connected chat without an agent or matching messages returns an empty result; unknown targets are errors. Viewing does not start an agent. Delivery semantics are in [Messaging](messaging.md).

## Scheduled tasks

| Command | Access | Result |
|---|---|---|
| `/task`, `/task list [RANGE]` | Local | Current agent's tasks |
| `/task list [RANGE] in CHAT_ID`, `/task list [RANGE] agent AGENT_ID` | Admin | Selected agent's tasks |
| `/task show TASK_ID`, `/task retry TASK_ID`, `/task delete TASK_ID` | Local for the current chat; Admin for another chat | Show, retry, or delete an individual task |
| `/task retry *`, `/task delete *` | Local | All current chat tasks |
| `/task retry * in CHAT_ID`, `/task delete * in CHAT_ID` | Admin | All selected chat tasks |

An individual task ID identifies its agent: do not add a target. Here `*` means tasks of one chat, never all bot agents. Bulk operations snapshot existing tasks, need no confirmation, and report successful/skipped counts and errors. Task lists show ID as code, execution time or cron/timezone in italic, state/missed count, description in bold and instruction text as pre; output can be truncated. Tasks can be listed/deleted in passive chats.

Retry requires an enabled agent and does not enable it. It does not duplicate queued/processing events; a task with nothing missed or failed cannot be retried. A cron retry submits one combined missed event while retaining its schedule. Delete removes the task and future cron firings. Task creation belongs to agent scheduler tools, not these Telegram commands. See [Scheduler](scheduler.md) for ordering, recovery, and missed-event behavior.

## Chats and group triggers

| Command | Access | Result |
|---|---|---|
| `/chat`, `/chat info` | Local | Current chat details |
| `/chat info CHAT_ID` | Admin | Selected connected chat details |
| `/chat list [RANGE]` | Admin | Connected chats ordered by chat ID |
| `/chat leave` | Local | Leave the current non-private chat |
| `/chat leave CHAT_ID` | Admin | Leave a selected non-private chat |
| `/triggers` | Manager or higher, group only | Current trigger phrases, each as code |
| `/triggers set [TRIGGER …]` | Manager or higher, group only | Replace the phrases; no phrases clears them |

Chat lists/details hide other private chat IDs, using agent identity where available. Details include connection, type/title, agent state and available Telegram permissions. Leave removes that dialogue's history, context, notes, queue, tasks and related state, while preserving shared files/wiki/Git. It is not valid for a private chat; use stop there. Connecting a bot to a new chat is a Telegram action.

At most 200 trigger phrases are accepted, each 2–50 characters with no newline. Use code/spoiler formatting for a phrase containing spaces, for example `/triggers set` followed by the inline-code phrase `Hello Assistant`. Matching ignores case and requires non-letter boundaries. Triggers remain while disabled and editing them does not enable the agent. See [Agents](agents.md) and [Channels and discussions](channels-and-discussions.md).

## Users, ownership and rules

These commands require Admin and a private chat, except that ownership transfer requires Owner.

| Command | Result |
|---|---|
| `/user list [RANGE]` | Authorized users: ID as code, username/name, role in italic |
| `/user set USER_ID [ROLE]` | Assign `user` (default), `manager`, or `admin` |
| `/user delete USER_ID` | Remove authorization and stop/remove the user's dialogue |
| `/owner` | Owner ID and available username/name |
| `/owner set USER_ID` | Transfer ownership to an already authorized user |
| `/rules` | Download current bot-wide `AGENTS.md` |
| `/rules set` | Replace rules using the document reply protocol below |
| `/rules set PRE_BLOCK` | Replace rules with the exact contents of one nonempty Telegram pre block |

Users sort by owner/admin/manager/user, then ascending user ID. Admin can manage only user/manager, cannot change another admin, assign admin, or change itself. Owner can manage admins but cannot alter/remove the owner through `/user`. Ownership transfer is atomic; the previous owner becomes admin. Transfer to self is unchanged. No confirmation is required. This changes application ownership, not BotFather ownership. Master assignment differs; see [Master bot](master-bot.md).

Rules are shared by all bot agents. Updating them waits for current work and clears contexts to replace instructions; history, notes, wiki and tasks remain. `/rules set` has no `force` argument. The inline form accepts exactly one pre block and preserves whitespace; whitespace-only content is rejected. It ignores the quoted message entirely, including an attached document and its ownership/edit status. Sending a document in reply to the inline form is not a rules upload: only the argument-free `/rules set` invitation accepts one. See [Security](security.md).

## Files and Git

All commands below require Admin in a private child-bot chat. Paths refer to this bot's directory. Path traversal, symlinks and protected dot directories are rejected; `.temp` is accessible to administrators. See [Storage](storage.md) for the layout.

| Command | Result |
|---|---|
| `/ls [PATH]` | List a directory; default is the bot root |
| `/cat PATH` | File name and UTF-8 text as pre, truncated after 3,000 content characters |
| `/download PATH` | Send a file as a Telegram document |
| `/upload PATH` | Save an uploaded document through the reply protocol |
| `/edit PATH PRE_BLOCK` | Write exactly the pre-block contents |
| `/mv FROM TO` | Move a file/directory |
| `/rm PATH` | Remove a file/directory recursively, without confirmation |
| `/git setup` | Show configuration and token presence, never token value |
| `/git setup BRANCH [REMOTE_URL [TOKEN]]` | Replace wiki/Git with the selected remote branch |
| `/git changes` | Show staged, unstaged, untracked files and unpushed commits |
| `/git sync MESSAGE` | Stage changes including deletions, commit if needed, then push |
| `/temp`, `/temp status` | Temporary file counts/bytes, including expired totals |
| `/temp cleanup` | Delete `.temp` files older than 24 hours by mtime |

For `/upload` and `/rules set`, either send a document replying to your command, or send the command replying to your document. The quoted message must be your own, unedited, in the same chat, and not sent on behalf of a chat. A command without a document prompts for one. Invalid document replies are handled as command failures rather than forwarded to the agent. For a spaced path, format the path as one inline-code argument, for example `wiki/Project notes.md`.

Git setup requires an HTTPS remote without embedded credentials. Omitted remote/token reuse configured values; first setup needs a remote. Setup first clones into staging; a clone failure preserves the wiki. Successful replacement discards local modifications, ignored files and unpushed commits, preserving `.temp`; remote branches containing `.temp` are rejected. Git changes/sync do not fetch or pull. Sync still pushes when no new commit is necessary. The commit message may be ordinary words or a multiline pre block. Token-bearing setup messages are excluded from agent history and deletion is attempted even on failure. Cleanup retains fresh files and reports removed files/bytes and failures.

## Vault, WebSocket and MCP

| Command | Access | Result |
|---|---|---|
| `/vault`, `/vault list` | Admin, private | List secret names only |
| `/vault set NAME TOKEN`, `/vault delete NAME` | Admin, private | Set/replace or delete a bot secret |
| `/ws list [AGENT_ID]`, `/ws list in CHAT_ID` | Admin | Connections for the current/selected agent |
| `/ws close CONNECTION_ID`, `/ws delete CONNECTION_ID` | Admin | Close a connection or delete its record |
| `/mcp list`, `/mcp show NAME` | Admin, private | Show HTTP MCP configuration with sensitive values hidden |
| `/mcp set NAME PRE_TOML` | Admin, private | Set/replace one server using a Telegram TOML pre block |
| `/mcp test NAME`, `/mcp delete NAME` | Admin, private | Test or delete a configured server |

Vault values are shared with agents of this bot through `vault_get`, never returned by Telegram commands. Set messages have deletion attempted even on failure. See [Security](security.md), [WebSocket](websocket.md), and [MCP](mcp.md) for name constraints, exact TOML fields, connection lifecycle and secret handling. Tool boundaries are described in [Agent contract](agent-contract.md); system responsibilities in [Architecture](architecture.md).
