function availableCommands({ master = false, role, group = false }) {
  if (master)
    return {
      bot: "/bot list [RANGE]\n/bot add TOKEN [OWNER_ID]\n/bot info @BotName\n/bot owner [set] @BotName [USER_ID]\n/bot delete @BotName [BOT_ID [all]]",
    };
  const admin = ["admin", "owner"].includes(role),
    manager = admin || role === "manager",
    local = group ? manager : Boolean(role);
  const result = {};
  if (local) {
    result.agent = "/agent status\n/agent start\n/agent stop\n/agent clear";
    result.task =
      "/task list [RANGE]\n/task show TASK_ID\n/task retry TASK_ID|*\n/task delete TASK_ID|*";
    result.chat = "/chat info" + (group ? "\n/chat leave" : "");
  }
  if (group && manager)
    result.triggers = "/triggers\n/triggers set [TRIGGER …]";
  if (admin) {
    result.ws = "/ws list [AGENT_ID|in CHAT_ID]\n/ws close CONNECTION_ID\n/ws delete CONNECTION_ID";
    result.agent +=
      "\n/agent status|stop|clear [AGENT_ID|in CHAT_ID]\n/agent stop|clear *\n/agent start in CHAT_ID\n/agent list [RANGE]\n/agent messages [RANGE] [(from|to) agent AGENT_ID|chat CHAT_ID]\n/agent model [AGENT_ID|in CHAT_ID|default]\n/agent model set [AGENT_ID|in CHAT_ID|*|default] MODEL_NAME\n/agent models";
    result.task +=
      "\n/task list [RANGE] [agent AGENT_ID|in CHAT_ID]\n/task retry|delete * in CHAT_ID";
    result.chat +=
      "\n/chat list [RANGE]\n/chat info CHAT_ID\n/chat leave CHAT_ID";
  }
  if (admin && !group) {
    if(!group) result.mcp="/mcp list\n/mcp show NAME\n/mcp set NAME PRE_CONFIG\n/mcp auth NAME\n/mcp logout NAME\n/mcp test NAME\n/mcp delete NAME";
    result.vault = "/vault list\n/vault set NAME TOKEN\n/vault delete NAME";
    result.user =
      "/user list [RANGE]\n/user set USER_ID [role]\n/user delete USER_ID";
    result.owner = "/owner" + (role === "owner" ? "\n/owner set USER_ID" : "");
    result.rules = "/rules\n/rules set\n/rules set PRE_BLOCK";
    result.git =
      "/git setup [BRANCH [REMOTE_URL [TOKEN]]]\n/git changes\n/git sync MESSAGE";
    result.file =
      "/ls [PATH]\n/cat PATH\n/download PATH\n/upload PATH\n/edit PATH PRE_BLOCK\n/mv FROM TO\n/rm PATH";
    result.temp = "/temp status\n/temp cleanup";
  }
  return result;
}

const descriptions = {
  agent: 'Control conversational agents: inspect their state, start or stop them, reset context, inspect inter-agent messages and choose models. A local command needs user or higher in private chats, manager or higher in groups. Explicit targets and model commands need admin or owner.',
  task: 'Inspect scheduled actions, retry missed or failed actions, or delete schedules. Local operations need user or higher in private chats, manager or higher in groups. Operations on another chat need admin or owner. Ask the agent to create a task; these commands manage existing tasks.',
  chat: 'Inspect chats connected to this bot and their agent state, or make the bot leave a group/channel. Local information needs user or higher in private chats, manager or higher in groups. Explicit chat targets and lists need admin or owner.',
  triggers: 'Manage phrases that address the agent in this group. Requires manager or higher. Matching a phrase activates the agent and starts loud mode, just like an explicit mention. Telegram administrators do not automatically have application roles.',
  ws: 'Inspect and manage controller-owned WebSocket connections. Requires admin or owner. Closed connections retain their unread queue until deleted or expired.',
  mcp: 'Configure HTTP MCP servers whose tools are available to this bot’s agents, and authorize shared external accounts through OAuth. Requires admin or owner in a private chat. Stdio servers and WebSocket MCP are not supported.',
  vault: 'Manage this bot’s shared secret store. Requires admin or owner in a private chat. Agents may use secrets through vault_get; Telegram commands never return secret values.',
  user: 'Manage authorization for this bot. Requires admin or owner in a private chat. Roles inherit lower-level permissions:\nuser — use the bot in private messages and manage your own agent and tasks.\nmanager — all user rights, plus add the bot to groups/channels and manage group agents, tasks and triggers.\nadmin — administer the bot, except appointing admins or transferring ownership.\nowner — all rights, including appointing admins and transferring ownership.\nThese are application roles, separate from Telegram administrator rights and BotFather ownership.',
  owner: 'Inspect or transfer application ownership of this bot. Requires admin or owner in a private chat to inspect; only owner may transfer. Application ownership is separate from BotFather ownership.',
  rules: 'Read or replace the bot-wide AGENTS.md instructions. Requires admin or owner in a private chat. Rules apply to every agent of this bot. Updates wait for active work and reset contexts; chat history, notes, files and scheduled tasks remain.',
  git: 'Configure optional Git synchronization of this bot’s directory, inspect changes and push commits. Requires admin or owner in a private chat. Ordinary agent synchronization does not fetch or pull.',
  file: 'Manage files in this bot’s directory. Requires admin or owner in a private chat. Paths are relative to the bot root; traversal, symlinks and protected service directories are rejected. Temporary files are accessible but expire.',
  temp: 'Inspect or remove expired temporary files in this bot’s .temp directory. Requires admin or owner in a private chat. Expiry is based on file modification time, not last access.',
  bot: 'Manage registered child bots through the master bot, which has no conversational agent. Available only to the configured service owner in private messages. These commands do not operate on BotFather ownership.',
};

const details = {
  '/agent status': 'Show the current chat’s agent ID, enabled/disabled mode, execution status and pending queue size. Admins also see the model. This does not start the agent; /agent is an alias.',
  '/agent start': 'Enable the current chat’s agent. New groups and supergroups initially record history without an agent. Starting restores operation and exposes accumulated missed scheduled actions. It does not interrupt a stop still in progress.',
  '/agent stop': 'Disable the current agent, stop triggers and loud mode, and discard its pending operational queue. Active work, including subagents, finishes before context removal. Agent ID, model, notes, history, schedules and shared files remain. Use /agent start to resume.',
  '/agent clear': 'Reset the current agent’s context and reload instructions after active work, including subagents, finishes. Pending events wait for the reset. Enabled state, queue, notes, history, schedules and shared files remain. This is not a stop.',
  '/agent status AGENT_ID': 'Show the selected agent’s state, queue size and model. The agent must belong to this bot. An explicit target requires admin or owner, even if it selects the current chat.',
  '/agent status in CHAT_ID': 'Show the state of a connected chat, including one without an agent. Requires admin or owner; use the numeric Telegram chat ID from /chat list.',
  '/agent stop AGENT_ID': 'Stop the selected agent using the same completion and data-retention rules as a local stop. Requires admin or owner. Restart it with /agent start in CHAT_ID.',
  '/agent stop in CHAT_ID': 'Stop the selected connected chat’s agent. Requires admin or owner. History collection continues while a group agent is disabled; notes and schedules remain.',
  '/agent clear AGENT_ID': 'Reset the selected agent after its active work finishes. Its queue waits; enabled state and durable data remain. Requires admin or owner.',
  '/agent clear in CHAT_ID': 'Reset the selected connected chat’s agent without disabling it or discarding queued events. Requires admin or owner.',
  '/agent stop *': 'Stop every existing agent of this bot, including those in private chats. Each finishes active work before its context is removed. Notes, history, schedules and files remain. Requires admin or owner; no confirmation is requested.',
  '/agent clear *': 'Reset every existing agent of this bot after each agent’s active work finishes. Queues wait for the reset; agents retain enabled state, notes, history, schedules and files. Requires admin or owner.',
  '/agent start in CHAT_ID': 'Enable the agent in a connected group, supergroup or authorized private chat. Requires admin or owner. Channels cannot have agents. Start accepts a chat target, not an agent ID or *.',
  '/agent list [RANGE]': 'List this bot’s agents, oldest first, including disabled ones. Entries show agent ID, chat type, username/title and enabled state. Other private chat IDs are hidden. RANGE defaults to 1-10; 5 selects one row, 11-20 selects ten. Requires admin or owner.',
  '/agent messages [RANGE]': 'Read the current chat’s inter-agent message log, newest first, retained for seven days. RANGE defaults to 1-10. Long message text may be truncated; select a single row for more room. Viewing the log does not start an agent. Requires admin or owner.',
  '/agent messages [RANGE] [(from|to) agent AGENT_ID|chat CHAT_ID]': 'Filter the log by one agent or connected chat before pagination. Without from/to, include both incoming and outgoing messages; from selects the sender, to the recipient. Example: /agent messages 11-20 from agent a1. Records remain scoped to this bot. Requires admin or owner.',
  '/agent model [AGENT_ID|in CHAT_ID|default]': 'Read the current model, a selected agent/chat model, or the default for newly created agents. The selected chat must already have an agent. Example: /agent model in -123. Requires admin or owner.',
  '/agent model set [AGENT_ID|in CHAT_ID|*|default] MODEL_NAME': 'Choose a model from /agent models. With no target, change the current agent; * changes all existing agents, including disabled ones. default changes only future agents. The change applies next turn without interrupting work or resetting context. Requires admin or owner.',
  '/agent models': 'List model names available from the running Codex runtime. Use an exact listed name with /agent model set. Requires admin or owner; model information is not exposed to other roles.',
  '/task list [RANGE]': 'List the current chat’s tasks with ID, time or cron/timezone, state, missed count, description and full instruction. /task is an alias. RANGE defaults to 1-10. Listing does not enable a stopped agent; long output may be truncated.',
  '/task list [RANGE] [agent AGENT_ID|in CHAT_ID]': 'List tasks of another agent or connected chat. Example: /task list 11-20 in -123. Requires admin or owner. The target belongs to this bot; a passive chat without tasks returns an empty list.',
  '/task show TASK_ID': 'Show one task’s complete stored details. The task ID determines its chat, so do not append a target. Local permissions suffice for the current chat; another chat requires admin or owner.',
  '/task retry TASK_ID': 'Queue a missed or failed action for another attempt. Its agent must be enabled. Already queued/processing actions are not duplicated, and a task with nothing missed cannot be retried. Retrying may repeat effects completed before a failure.',
  '/task retry *': 'Retry all eligible missed/failed tasks in the current chat. The agent must be enabled. A cron task submits one combined missed event and keeps its schedule. Reports successful/skipped counts; * means this chat only.',
  '/task delete TASK_ID': 'Remove one task and future scheduled firings without confirmation. This does not undo effects already performed. The task ID identifies the chat; another chat requires admin or owner.',
  '/task delete *': 'Delete all tasks currently present in this chat without confirmation. Includes recurring schedules. Does not delete tasks of other agents; works even when the local agent is disabled.',
  '/task retry * in CHAT_ID': 'Retry all eligible missed/failed tasks of the selected connected chat. Requires admin or owner and an enabled target agent. Does not retry tasks across all bot chats.',
  '/task delete * in CHAT_ID': 'Delete all tasks in the selected connected chat without confirmation. Requires admin or owner. Tasks in other chats remain; an active action’s already completed effects are not undone.',
  '/chat info': 'Show current chat identity, type/title, connection and available Telegram permissions, plus agent ID and state when present. /chat is an alias. This does not create or enable an agent.',
  '/chat list [RANGE]': 'List connected chats ordered by numeric chat ID. Use these IDs with explicit-target commands. Other private chat IDs are hidden, with agent identity used instead. RANGE defaults to 1-10. Requires admin or owner.',
  '/chat info CHAT_ID': 'Inspect another connected chat and its agent ID/state when present. Requires admin or owner. Private-chat identifiers follow privacy restrictions; this command does not read the chat’s history.',
  '/chat leave': 'Make the bot leave this non-private chat. Deletes its history, context, notes, queue, tasks and related state; shared wiki/Git files remain. Requires manager or higher. No confirmation is requested. In private chats use /agent stop.',
  '/chat leave CHAT_ID': 'Leave a selected connected non-private chat and delete its chat-specific data. Requires admin or owner. Shared bot files and Git remain. Adding the bot again creates a fresh chat record.',
  '/triggers': 'Show current group trigger phrases, one code-formatted phrase per line. Does not enable a disabled agent. Mentions and replies remain separate built-in triggers.',
  '/triggers set [TRIGGER …]': 'Replace the complete phrase list; no phrases clears it. Up to 200 phrases, each 2-50 characters with no newline. Put a spaced phrase in code or spoiler. Matching ignores case and requires no letter immediately on either side.',
  '/ws list [AGENT_ID|in CHAT_ID]': 'List the current or selected agent’s connections with ID, description/origin, opened time, sent/received bytes and unread queue count/bytes. URLs containing secrets are not shown. Closed records remain listed and count toward the ten-connection limit.',
  '/ws close CONNECTION_ID': 'Close the connection and notify its agent. The unread queue and binary files remain available. One hour after closure, the record, queue and connection’s binary directory are deleted. Move needed files elsewhere before expiry.',
  '/ws delete CONNECTION_ID': 'Close the connection, discard its unread queue and immediately delete its binary directory and record, freeing a connection slot. The agent is notified. Move needed binary files elsewhere before deletion.',
  '/mcp list': 'List configured HTTP MCP servers with current connection status: connected, disabled, authorization required, or unavailable. Enabled entries are checked without model turns or application tool calls. Connected does not guarantee permission for every tool. Credentials stay hidden. /mcp is an alias. Settings belong to this bot, not all bots on the server.',
  '/mcp show NAME': 'Show one server’s configuration with sensitive URL/header values hidden. Use this to check settings before replacing them.',
  '/mcp set NAME PRE_CONFIG': 'Create or replace one HTTP MCP server using one Telegram pre block of JSON or native-style TOML configuration. Supply url (or serverUrl), optional http_headers and oauth settings. OAuth accepts client_id/clientId and client_secret/clientSecret; no stdio or vault references. Replacing an entry cancels pending login and removes its local OAuth credentials. The command message is deleted where possible. Agent configuration refresh waits for active work.',
  '/mcp auth NAME': 'Start OAuth login for a configured connection. One external account is shared by all agents of this bot for this connection. Open the supplied link, approve access, then copy the entire callback URL from the address bar even if the page fails to load. Send that URL as a reply to your own unedited /mcp auth NAME command within ten minutes. The callback is deleted where possible and never sent to the agent. A new login replaces the pending attempt; it does not remove an existing account until a successful login replaces it.',
  '/mcp logout NAME': 'Cancel pending login and remove this connection’s locally stored OAuth credentials. Other bot connections remain authorized. Agents reload after their current work without losing context. This does not necessarily revoke access at the external service, and static authorization headers are not removed.',
  '/mcp test NAME': 'Test a configured server using the native Codex MCP connection. This checks connectivity/tool discovery without asking the model to execute a task. It does not make arbitrary tool calls.',
  '/mcp delete NAME': 'Cancel pending login, remove local OAuth credentials and delete this server’s configuration. Agents refresh their available MCP tools after active work finishes; conversation context is retained. This does not necessarily revoke the account grant at the external service.',
  '/vault list': 'List secret names only; /vault is an alias. Existing values cannot be read through a Telegram command.',
  '/vault set NAME TOKEN': 'Create or replace a secret used by this bot’s agents. Put tokens containing spaces in code or spoiler. Deletion of the command message is attempted even on failure; client copies cannot be erased. Never paste a token into ordinary agent conversation.',
  '/vault delete NAME': 'Delete the named secret. Future vault_get calls can no longer retrieve it. Does not revoke the token at its external provider.',
  '/user list [RANGE]': 'List authorized users as ID, username/name and role. Ordered owner, admin, manager, user, then numeric user ID. RANGE defaults to 1-10; use 5 or 11-20 for another slice.',
  '/user set USER_ID [role]': 'Authorize a numeric user ID or replace its role; omitted role means user. Allowed roles: user, manager, admin. Admin can manage only user/manager and cannot change itself or another admin. Only owner can assign admin. The owner cannot change its own role here.',
  '/user delete USER_ID': 'Remove authorization and stop/remove that user’s private dialogue and related data. Admin can remove only user/manager; owner can also remove admins. The owner cannot be removed here. Ownership transfer uses /owner set.',
  '/owner': 'Show this bot’s application owner ID and known name/username. Ownership grants every application permission; it does not imply ownership in BotFather.',
  '/owner set USER_ID': 'Transfer ownership to an already authorized user. Only the current owner can do this. The previous owner becomes admin; transfer to self changes nothing. No confirmation is requested. BotFather ownership is unchanged.',
  '/rules': 'Send the current bot-wide AGENTS.md as a document. These are behavior instructions for all agents, separate from chat notes and shared wiki files.',
  '/rules set': 'Replace rules from a document: reply with this command to your own unedited document, or send a document replying to your own unedited /rules set message in this chat. Without a document, receive an upload prompt. Foreign/edited reply targets are rejected.',
  '/rules set PRE_BLOCK': 'Replace rules with exactly one nonempty Telegram pre block, preserving spaces and newlines. A quoted attachment is ignored, including its ownership/edit status. Plain text or code is not accepted here. A later document reply to this form is not a rules upload.',
  '/git setup [BRANCH [REMOTE_URL [TOKEN]]]': 'With no arguments, show branch, HTTPS remote and token presence, never token value. With BRANCH, clone the selected remote branch and replace local wiki/Git, discarding changes, ignored files and unpushed commits; .temp remains. Omitted remote/token reuse stored values; first setup needs a remote. Clone failure preserves current files. Token-bearing commands are deleted where possible.',
  '/git setup': 'Show the current branch, HTTPS remote and whether a token is configured, never the token value. Does not synchronize, replace files or change Git settings.',
  '/git setup BRANCH [REMOTE_URL [TOKEN]]': 'Clone the selected remote branch and replace local wiki/Git, discarding changes, ignored files and unpushed commits; .temp remains. Omitted remote/token reuse stored values; first setup needs a remote. Clone failure preserves current files. Token-bearing commands are deleted where possible.',
  '/git changes': 'Show staged, unstaged and untracked files plus commits not yet pushed to the configured remote branch. Does not fetch. Returns an error if Git is not configured.',
  '/git sync MESSAGE': 'Stage all changes including deletions, commit if needed, then push. Supply ordinary words or one multiline pre block as the commit message. Push still runs if no commit is needed. Does not fetch/pull; push conflicts require manual resolution.',
  '/ls [PATH]': 'List a directory’s entries. Without PATH, list the bot root. Use code or spoiler for a path containing spaces. Service directories may appear but protected paths cannot be manipulated.',
  '/cat PATH': 'Send the UTF-8 file contents as a pre block with its name. Content is truncated after 3,000 characters; use /download for the complete file.',
  '/download PATH': 'Send an existing local file as a Telegram document. This command differs from the agent’s download tool, which retrieves Telegram files.',
  '/upload PATH': 'Save a document at PATH. Reply with this command to your own unedited document, or reply with a document to your own unedited /upload PATH command in this chat. Without a document, receive a prompt. Foreign/edited reply targets are rejected.',
  '/edit PATH PRE_BLOCK': 'Write exactly the pre-block contents to PATH, replacing an existing file. The path is one argument; code/spoiler preserves spaces. Supply actual Telegram pre formatting rather than literal Markdown fence characters.',
  '/mv FROM TO': 'Move a file or directory from FROM to TO inside the bot directory. Each path is one argument; use code/spoiler for spaces. Protected paths and symlinks are rejected.',
  '/rm PATH': 'Delete a file or entire directory recursively, without confirmation. This is permanent local deletion; Git recovery is possible only for previously committed content. Protected service paths are rejected.',
  '/temp status': 'Show temporary file totals and bytes, including expired totals. /temp is an alias. Files become eligible for cleanup after 24 hours based on mtime.',
  '/temp cleanup': 'Delete only expired .temp files and report removed file/byte counts and failures. Fresh files remain. If deletion fails, remove reported files manually or correct server filesystem permissions.',
  '/bot list [RANGE]': 'List registered child bots ordered by numeric Telegram bot ID. RANGE defaults to 1-10; /bot is an alias. Entries show username, bot ID and application owner ID.',
  '/bot add TOKEN [OWNER_ID]': 'Register an independent Telegram bot created through BotFather. The controller validates getMe, saves the token and starts its poller. Without OWNER_ID the command sender becomes application owner. Duplicate registrations and the master itself are rejected. The token-bearing message is deleted where possible.',
  '/bot info @BotName': 'Show the registered child’s identity, numeric bot ID, application owner and chat/agent counts. Token values are never returned.',
  '/bot owner @BotName': 'Show the child’s current application owner. This does not query or change BotFather ownership.',
  '/bot owner set @BotName USER_ID': 'Assign an application owner, including a user not previously authorized for that child. The previous owner becomes admin. Other bot data remains; BotFather ownership is unchanged.',
  '/bot delete @BotName': 'Show the bot’s identity and exact full deletion commands. This short form does not delete anything. Repeat its numeric Telegram BOT_ID to perform deletion.',
  '/bot delete @BotName BOT_ID': 'Unregister the child and remove controller data, credentials, rules, histories, contexts, notes, schedules and temporary files. Permanent wiki/Git files remain. Does not delete the Telegram bot through BotFather.',
  '/bot delete @BotName BOT_ID all': 'Unregister the child and delete all its local data, including the entire wiki/Git directory. The numeric BOT_ID must match. No additional confirmation is requested; BotFather registration remains.',
};

// Expand forms with different effects instead of making users decode alternatives.
const expansions = {
  '/agent status|stop|clear [AGENT_ID|in CHAT_ID]': ['status','stop','clear'].flatMap(a=>[`/agent ${a} AGENT_ID`,`/agent ${a} in CHAT_ID`]),
  '/agent stop|clear *': ['/agent stop *','/agent clear *'],
  '/task retry TASK_ID|*': ['/task retry TASK_ID','/task retry *'],
  '/task delete TASK_ID|*': ['/task delete TASK_ID','/task delete *'],
  '/task retry|delete * in CHAT_ID': ['/task retry * in CHAT_ID','/task delete * in CHAT_ID'],
  '/bot owner [set] @BotName [USER_ID]': ['/bot owner @BotName','/bot owner set @BotName USER_ID'],
  '/bot delete @BotName [BOT_ID [all]]': ['/bot delete @BotName','/bot delete @BotName BOT_ID','/bot delete @BotName BOT_ID all'],
  '/git setup [BRANCH [REMOTE_URL [TOKEN]]]': ['/git setup','/git setup BRANCH [REMOTE_URL [TOKEN]]'],
};

export function helpSections(options) {
  return Object.fromEntries(Object.entries(availableCommands(options)).map(([name, syntax])=>[name, {
    description:descriptions[name],
    commands:syntax.split('\n').flatMap(s=>expansions[s]??[s]).map(s=>({syntax:s,description:details[s]})),
  }]));
}

export function helpMessages(sections, section) {
  const chunks=[];
  let current={text:'',entities:[]};
  const add=(text,codeLength=0)=>{
    const separator=current.text?'\n\n':'';
    if(current.text.length+separator.length+text.length>4000){chunks.push(current);current={text:'',entities:[]};}
    const prefix=current.text?'\n\n':'';
    const offset=current.text.length+prefix.length;
    current.text+=prefix+text;
    if(codeLength)current.entities.push({type:'code',offset,length:codeLength});
  };
  if(section){
    const entry=sections[section];add(entry.description);
    for(const c of entry.commands)add(c.syntax+'\n'+c.description,c.syntax.length);
  }else{
    add('Spaces and newlines separate arguments. Telegram code or spoiler formatting keeps a phrase with spaces as one argument. A pre block keeps multiline text together, only where supported: /edit, /git sync, /rules set and /mcp set. Literal Markdown fences are not pre formatting. Other styling is rejected.\nUppercase names are placeholders; brackets mark optional arguments, not literal characters. RANGE is a position (5) or inclusive range (11-20); default: 1-10.');
    for(const [name,entry] of Object.entries(sections)){
      const command='/help '+name;add(command+'\n'+entry.description,command.length);
    }
    if(!Object.keys(sections).length)add('No command sections are available to you in this chat.');
  }
  if(current.text)chunks.push(current);
  return chunks;
}
