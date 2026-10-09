export function helpSections({ master = false, role, group = false }) {
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
    result.agent +=
      "\n/agent status|stop|clear [AGENT_ID|in CHAT_ID]\n/agent stop|clear *\n/agent start in CHAT_ID\n/agent list [RANGE]\n/agent messages [RANGE] [(from|to) agent AGENT_ID|chat CHAT_ID]\n/agent model [AGENT_ID|in CHAT_ID|default]\n/agent model set [AGENT_ID|in CHAT_ID|*|default] MODEL_NAME\n/agent models";
    result.task +=
      "\n/task list [RANGE] [agent AGENT_ID|in CHAT_ID]\n/task retry|delete * in CHAT_ID";
    result.chat +=
      "\n/chat list [RANGE]\n/chat info CHAT_ID\n/chat leave CHAT_ID";
  }
  if (admin && !group) {
    result.user =
      "/user list [RANGE]\n/user set USER_ID [role]\n/user delete USER_ID";
    result.owner = "/owner" + (role === "owner" ? "\n/owner set USER_ID" : "");
    result.rules = "/rules\n/rules set";
    result.git =
      "/git setup [BRANCH [REMOTE_URL [TOKEN]]]\n/git changes\n/git sync MESSAGE";
    result.file =
      "/ls [PATH]\n/cat PATH\n/download PATH\n/upload PATH\n/edit PATH PRE_BLOCK\n/mv FROM TO\n/rm PATH";
    result.temp = "/temp status\n/temp cleanup";
  }
  return result;
}
