# Child bot commands

[Wiki home](index.md) · [Master bot](master-bot.md) · [Operations](operations.md)

These commands control the child bot receiving the message. Roles belong to that bot and inherit permissions: `user` → `manager` → `admin` → `owner`. Telegram chat administrators do not automatically receive application roles. Unauthorized private messages are ignored. Channels do not execute these commands. For chat routing and supported chat types, see [Channels and discussions](channels-and-discussions.md).

In the tables, **local** means `user` or higher in a private chat and `manager` or higher in a group/supergroup. **Admin** means `admin` or `owner`. Explicit targets require Admin even when they identify the current chat. Commands cannot select another bot's data.

## Syntax, formatting and help

Optional arguments appear in brackets; uppercase names are placeholders. Commands may use the Telegram suffix `/command@BotName`; a suffix naming another bot is ignored. Ordinary whitespace, including newlines, separates arguments. Telegram inline `code` and `spoiler` entities preserve their contents as one argument; a `pre` entity preserves a multiline argument. Entity boundaries also separate arguments. Quotes alone do not group words. Other styling, overlapping entities, and formatting over the command name are rejected. Pre blocks are accepted only for `/edit`, `/git sync`, the instructions argument of `/rules set`, and the TOML argument of `/mcp set`. Send actual Telegram formatted entities: literal Markdown fence characters alone do not create a pre block.

`RANGE` is a positive one-based position `N` or inclusive `FROM-TO`, for example `11-20`. The default is positions 1–10. Filters apply before pagination. Lists show `FROM-TO / TOTAL` or an empty-result message. Long formatted output may be truncated; it is not automatically attached as a file. Controller replies, prompts, statuses and errors are in English; user-supplied names and content retain their original language. Responses and errors reply to the command. Syntax errors offer the relevant help section where recognized. Commands are handled by the controller without a model turn; command text is not ordinary agent history.

| Command | Result |
|---|---|
| `/help` | Argument-formatting guide and an index of available sections with descriptions |
| `/start [inline]` | Private chat with a child bot: explain how to enable the agent and start a new inline query; does not create or enable an agent |
| `/help SECTION` or `/help COMMAND` | One available section, addressed by its name or by a command it contains; for example `/help ls`, `/help mv` and `/help edit` all show `/help file` |
| `/say MESSAGE` | Hidden free-form message to this enabled group agent, requiring `user` or higher. See [hidden correspondence](ephemeral.md) and `/help say`. |

Help is in English and follows role and chat restrictions; an unavailable or unknown section/command is an error. Command-name aliases resolve only within available sections and do not add duplicate entries to the section index. Existing section names take precedence. `/help SECTION` explains each available command's effects, targets, defaults, permissions and retained/deleted data. Command syntax uses code entities. Long help is sent as multiple replies, split between entries without truncation. `/help user` also explains all four roles and their inherited permissions, distinct from Telegram administrator rights. Master help is documented on [Master bot](master-bot.md).

## Ephemeral group commands

At child-bot startup, the controller registers supported slash commands with Telegram's `is_ephemeral` flag for group users and administrators (default, English and Russian command lists). An ephemeral command and its controller replies are visible only to the invoking user and bot. Client command lists can refresh with a delay; early attempts may still arrive as ordinary messages. Explicit `/command@BotName` addressing worked before short commands refreshed in the Desktop probe. Unregistered commands do not automatically become ephemeral. More specific command lists configured outside this service can override its group defaults.

Fast commands send their result directly. After five seconds without a response, a delayed command displays `Processing…` and edits that message on completion. Commands issuing an attachment invitation never schedule processing; invitations are fresh messages and are never edited. Non-administrator bots have a 15-second native window for a new reply, so delayed completion uses an existing private acknowledgement. Already-expired private commands are acknowledged without executing their operation. A failed private response is logged and acknowledged without replaying the command or falling back to a public group reply. Shutdown and bot removal cancel pending response sessions. Ordinary incoming commands keep their ordinary response route.

In addition to controller commands and upload invitations, `/say` delivers hidden correspondence to the enabled group agent. It requires `user` or higher, uses free-form text/formatting instead of the administrative argument grammar, and exposes a prepared private response for agent editing/deletion. It grants no extra priority or permissions and does not open public listening. Other unmatched ephemeral messages, edits and callbacks remain excluded from ordinary history and agent/widget delivery. Controller-owned `/browse` callbacks and upload invitations are supported separately without agent/widget delivery. Agent-authored ephemeral interactive buttons and widgets remain deferred. See [hidden correspondence](ephemeral.md) and [verification](dev/ephemeral-command-verification.md).

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

These commands require Admin. Reading and replacing `/rules` (document or inline pre form) are available in private chats, groups and supergroups. User and ownership management require a private chat. Ownership transfer requires Owner.

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

All commands below require Admin. File commands `/ls`, `/cat`, `/download`, `/upload`, `/edit`, `/mv` and `/rm` are available in private child-bot chats, groups and supergroups. Git commands and `/temp` require a private child-bot chat. Paths refer to this bot's directory. Path traversal, symlinks and protected dot directories are rejected; `.temp` is accessible to administrators. See [Storage](storage.md) for the layout.

| Command | Result |
|---|---|
| `/browse [DIR]` | Open an interactive rich file browser; missing directories open the bot root |
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

For `/upload` and `/rules set`, send the command replying to your own unedited document in the same chat, not sent on behalf of a chat. Alternatively send the command without an attachment, then attach a document as a reply to the bot's invitation. The invitation binds the bot, chat/topic, user and original parsed command. It lives in memory for one hour, disappears on controller restart, closes after the first successful upload and permits retry after failure. Concurrent attempts cannot both write. Current authorization is checked again when the attachment arrives. Invitation text grants no authority; arbitrary agent or bot output does not create a pending upload. Expired or unmatched ephemeral replies are ignored as commands. Telegram may omit the quoted ephemeral message; without its address, start again with a new command.

The legacy ordinary-message form of replying with a document to your own unedited command remains supported. Ephemeral commands cannot be replied to as your own sent message in the tested Desktop client; use the bot invitation. For a spaced path, format the path as one inline-code argument, for example `wiki/Project notes.md`.

Git setup requires an HTTPS remote without embedded credentials. Omitted remote/token reuse configured values; first setup needs a remote. Setup first clones into staging; a clone failure preserves the wiki. Successful replacement discards local modifications, ignored files and unpushed commits, preserving `.temp`; remote branches containing `.temp` are rejected. Git changes/sync do not fetch or pull. Sync still pushes when no new commit is necessary. The commit message may be ordinary words or a multiline pre block. Token-bearing setup messages are excluded from agent history and deletion is attempted even on failure. Cleanup retains fresh files and reports removed files/bytes and failures.

### Interactive file browser

`/browse [DIR]` opens one rich message with clickable breadcrumbs, directory/file information, and actions. It runs in the controller without a model turn or enabled agent. An omitted/missing directory or file argument opens the root; forbidden paths and read errors remain errors. Format a spaced directory as one code/spoiler argument. `/ls` retains its plain-list behavior.

Directories show a `📁 ..` parent entry first on every page, with the folder icon and label inside one clickable button, followed by folders first and ten entries per page. The parent entry is omitted at the root and is excluded from pagination totals. Root uses the home icon (`🏠`); other breadcrumb segments use folder icons for directories and a file icon for the selected file; clickable segments include their icon in the same button. Their centered navigation row always contains five positions: back (`↩️`), previous (`◀️`), disabled entry range (`1-10/33`, or `0-0/0` when empty), next (`▶️`), and refresh (`🔄`). Unavailable controls remain visible and disabled; the row never changes shape. Active icon buttons in the navigation panels use the green `success` style, while disabled navigation controls remain unstyled. Breadcrumb/list links and file-action buttons keep their existing styles. File views have a centered five-position gallery row: back (`↩️`), previous file (`◀️`), a disabled one-based file position (`7 / 15`), next file (`▶️`), and refresh (`🔄`). The gallery includes all accessible regular files in the same directory, in listing order, and skips directories. First/last arrows are disabled without wraparound. Back returns to the directory page containing the selected file; Refresh recalculates the sibling list. Action and confirmation rows are centered too. Files show their full bot-relative path as inline code after `Path:`, followed by size and modification time. Valid UTF-8 text no larger than 2048 bytes shows up to its first 50 lines in a pre block with a known language when available. Truncation is marked outside the block. PNG/JPEG/WebP images up to 10 MiB use native photo previews; a confirmed Telegram preview rejection falls back to file information and document access.

| Action | Directory | File |
|---|---|---|
| `Upload` | Reply to an invitation with a document; preserve its name inside this directory | Replace this exact file regardless of the uploaded document's name |
| `Download` | Embed a fresh ZIP archive | Embed the original file as a document |
| `Delete` | Confirm recursive deletion | Confirm file deletion |
| `Copy` | Store this directory's path | Store this file's path |
| `Paste` | Copy the clipboard source inside this directory with its original name | Replace this file with the clipboard file |

Clipboard stores a path, not a snapshot: Paste reads its current contents. A directory cannot replace a file. Overwrites require confirmation; directory copies merge recursively, replace conflicting files and preserve other destination entries. Type conflicts, self/descendant copies and changed confirmation targets are rejected. Root deletion/copying is disabled. Deletion refuses directories with protected/unsupported descendants and never recursively removes hidden contents as a side effect.

One browse session exists per user per bot across chats. Another `/browse` deletes the old message and transfers clipboard, prepared cache and in-flight work. Old controls, confirmations and unused invitations become inactive. Upload invitations bind the exact user, bot, chat/topic, native message and fixed destination; navigation does not retarget them. An upload already admitted before another `/browse` continues to its original destination. Expired or restarted invitations cannot authorize writes.

Long operations disable controls and display status. A reopened browse carries the active operation without retargeting it. A failed merge may leave explicitly reported partial results; related prepared media are invalidated even after partial failure.

`Download` removes the previous visible attachment, rereads or rearchives the source and uploads a fresh document. Other redraws reuse prepared data and confirmed Telegram file IDs when available. Ephemeral edit responses alone provide no new IDs; the controller learns them from later callbacks. Switching objects hides the previous attachment. Refresh updates information/preview but leaves a download as its last requested snapshot. Mutations invalidate media.

Sessions expire after one idle hour or restart. Trees are limited to 2000 entries and 32 MiB of source bytes; individual files/uploads have a 32 MiB browser limit, subject to Telegram limits. Prepared media use at most 64 MiB per session. Unsafe paths, upload names, symlinks and non-regular files are unavailable. Each effect checks current admin/owner access. Ephemeral interfaces/invitations stay private; unknown delivery is not automatically replayed or retried publicly. Send a new `/browse` after an unknown-delivery error.

## Vault, WebSocket and MCP

| Command | Access | Result |
|---|---|---|
| `/vault`, `/vault list` | Admin, private | List secret names only |
| `/vault set NAME TOKEN`, `/vault delete NAME` | Admin, private | Set/replace or delete a bot secret |
| `/ws list [AGENT_ID]`, `/ws list in CHAT_ID` | Admin | Connections for the current/selected agent |
| `/ws close CONNECTION_ID`, `/ws delete CONNECTION_ID` | Admin | Close a connection or delete its record |
| `/mcp list`, `/mcp show NAME` | Admin, private | List live connection statuses or show HTTP MCP configuration with sensitive values hidden |
| `/mcp set NAME PRE_CONFIG` | Admin, private | Set/replace one server using a Telegram TOML pre block |
| `/mcp auth NAME` | Admin, private | Start OAuth; send the browser callback URL replying to your own unedited command within ten minutes |
| `/mcp logout NAME` | Admin, private | Cancel pending login and remove local OAuth credentials |
| `/mcp test NAME`, `/mcp delete NAME` | Admin, private | Test or delete a configured server |

Vault values are shared with agents of this bot through `vault_get`, never returned by Telegram commands. Set messages have deletion attempted even on failure. See [Security](security.md), [WebSocket](websocket.md), and [MCP](mcp.md) for name constraints, exact JSON/TOML fields, connection lifecycle and secret handling. Tool boundaries are described in [Agent contract](agent-contract.md); system responsibilities in [Architecture](architecture.md).

OAuth callback replies are service input, excluded from agent history and best-effort deleted. Their quoted `/mcp auth NAME` command must belong to the same user/chat and must not be edited. Both login completion and logout refresh agents after active work while retaining context. MCP replacement/deletion removes local OAuth credentials; logout does not remove static headers or necessarily revoke the external account grant.

In [forum groups](forum-groups.md), command replies and downloads stay in the invoking topic. `/agent start` enables one agent for the entire forum; topic changes do not create separate agents.

## Programmable widgets

Administrator/owner only. Filters select the owning agent, not the publication chat. `/help widget` gives expanded descriptions. See [widgets](widgets.md).

| Command | Behavior |
| --- | --- |
| `/widget` or `/widget list [RANGE]` | Current agent registrations |
| `/widget list [RANGE] agent AGENT_ID` | Selected owner agent |
| `/widget list [RANGE] in CHAT_ID` | Owner agent belonging to that chat |
| `/widget list [RANGE] all` | All registrations of this bot |
| `/widget show WIDGET_ID` | Metadata/counters/reason, without saved state |
| `/widget delete WIDGET_ID` | Delete registration, preserve message and notify owner |
| `/widget delete * [agent AGENT_ID |in CHAT_ID]` | Delete registrations of current/selected owner |

Stopped and zero-view registrations consume quota. Lists show Owner, Pending, Views and each chatId/messageId or inline ID. Only group/channel addresses receive links; private views never do. There are no administrator state-edit, manual stop/resume or bot-wide delete-all forms. Repair uses agent `update_widget`.
