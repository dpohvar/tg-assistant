// Only fixed categories and bounded machine values may reach service logs.
// Never serialize an Error, RPC response, stderr, prompt or request arguments.
const codes = new Set([
  "agent_failed",
  "codex_rpc_rejected",
  "codex_rpc_timeout",
  "codex_event_timeout",
  "codex_process_start_failed",
  "codex_process_exited",
  "codex_connection_failed",
  "codex_protocol_error",
  "mcp_config_failed",
  "mcp_connection_failed",
  "telegram_api_error",
  "telegram_transport_failed",
  "bot_not_configured",
  "connection_expired",
  "rules_replaced",
]);
const stages = new Set([
  "mcp_preflight",
  "initialize",
  "bot_profile",
  "thread_start",
  "thread_resume",
  "turn_start",
  "turn_wait",
  "subagent",
  "notification",
]);
const methods = new Set([
  "initialize",
  "config/read",
  "thread/start",
  "thread/resume",
  "thread/delete",
  "thread/compact/start",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "model/list",
  "mcpServerStatus/list",
]);
const infos = new Set([
  "contextWindowExceeded",
  "sessionBudgetExceeded",
  "usageLimitExceeded",
  "rateLimitExceeded",
  "flexUnavailable",
  "serverOverloaded",
  "cyberPolicy",
  "misalignmentPolicyViolation",
  "tooManyDenials",
  "internalServerError",
  "unauthorized",
  "badRequest",
  "threadRollbackFailed",
  "sandboxError",
  "other",
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "activeTurnNotSteerable",
]);
const signals = new Set([
  "SIGTERM",
  "SIGKILL",
  "SIGSEGV",
  "SIGABRT",
  "SIGILL",
  "SIGBUS",
  "SIGINT",
  "SIGHUP",
]);
const osCodes = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOEXEC",
  "ENOMEM",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNRESET",
]);
const reasons = [
  [
    "mixed_dynamic_tool_formats",
    /dynamic tools must use either canonical or legacy format consistently/i,
  ],
  [
    "invalid_tool_schema",
    /invalid schema|schema for (?:function|tool)|schema.*(?:not supported|invalid)/i,
  ],
  [
    "authentication_required",
    /unauthorized|authentication|not logged in|login required|token.*expired|invalid.*(?:api key|access token)/i,
  ],
  [
    "model_unavailable",
    /model.*(?:not found|not supported|not available|does not exist)|unsupported model/i,
  ],
  ["usage_limit", /usage limit|quota.*exceed|insufficient.quota/i],
  ["rate_limit", /rate limit|too many requests/i],
  [
    "sandbox_unavailable",
    /bwrap:|no permissions to create.*namespace|sandbox.*(?:failed|unavailable)|operation not permitted/i,
  ],
  [
    "invalid_configuration",
    /error loading config|failed to (?:load|parse).*config|invalid.*(?:config|permission)|unknown configuration field|unknown permission|permission.*not found/i,
  ],
  [
    "unsupported_parameter",
    /unexpected argument|unknown (?:variant|field)|unrecognized (?:argument|option)|missing field|invalid params/i,
  ],
  ["tls_error", /certificate|tls handshake|ssl error/i],
  [
    "network_error",
    /failed to connect|connection refused|dns|network.*unreachable|connection.*closed|stream.*disconnect/i,
  ],
  ["database_busy", /database.*(?:locked|busy)/i],
];
export function failureReason(message) {
  return typeof message === "string"
    ? reasons.find(([, pattern]) => pattern.test(message.slice(0, 16384)))?.[0]
    : undefined;
}
export function markFailure(error, details) {
  if (!error || typeof error !== "object")
    error = new Error("Unknown controller failure.");
  try {
    error.diagnostic = { ...error.diagnostic, ...details };
  } catch {}
  return error;
}
export function agentFailureDiagnostic(error) {
  const result = { code: codes.has(error?.code) ? error.code : "unknown" };
  const seen = new Set();
  let current = error;
  for (
    let n = 0;
    n < 4 && current && typeof current === "object" && !seen.has(current);
    n++, current = current.cause
  ) {
    seen.add(current);
    const d = current.diagnostic ?? {};
    if (result.stage === undefined && stages.has(d.stage))
      result.stage = d.stage;
    if (result.rpcMethod === undefined && methods.has(d.rpcMethod))
      result.rpcMethod = d.rpcMethod;
    if (
      result.rpcCode === undefined &&
      Number.isInteger(d.rpcCode) &&
      Math.abs(d.rpcCode) <= 2147483647
    )
      result.rpcCode = d.rpcCode;
    if (
      result.exitCode === undefined &&
      Number.isInteger(d.exitCode) &&
      d.exitCode >= -1 &&
      d.exitCode <= 255
    )
      result.exitCode = d.exitCode;
    if (result.signal === undefined && signals.has(d.signal))
      result.signal = d.signal;
    if (result.osCode === undefined && osCodes.has(current.code))
      result.osCode = current.code;
    const info = current.codexErrorInfo;
    const key =
      typeof info === "string"
        ? info
        : info && typeof info === "object"
          ? Object.keys(info).find((k) => infos.has(k))
          : undefined;
    if (result.codexErrorInfo === undefined && infos.has(key)) {
      result.codexErrorInfo = key;
      const status = info?.[key]?.httpStatusCode;
      if (Number.isInteger(status) && status >= 100 && status <= 599)
        result.httpStatusCode = status;
    }
    if (result.reason === undefined) {
      const reason = failureReason(current.message) ?? failureReason(d.stderr);
      if (reason) result.reason = reason;
    }
  }
  return result;
}
