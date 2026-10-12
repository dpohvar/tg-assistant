export const WIDGET_LIMITS = Object.freeze({
  widgets: 10,
  processes: 10,
  memory: 256 * 1024 * 1024,
  sampleMs: 500,
  heartbeatMs: 5000,
  silenceMs: 10000,
  teardownMs: 5000,
  stateBytes: 1024 * 1024,
  pending: 1000,
  eventBytes: 64 * 1024,
  pendingBytes: 8 * 1024 * 1024,
  frameBytes: 2 * 1024 * 1024,
});
export const HOOKS = new Set([
  "render",
  "onInit",
  "onCreate",
  "onReply",
  "onReaction",
  "onPoll",
  "onPollAnswer",
  "onStop",
  "onError",
]);
export function widgetError(code, detail = code) {
  return Object.assign(new Error(`${code}: ${detail}`), { code });
}
export function plainJSON(value, { allowUndefined = false } = {}) {
  const seen = new Set();
  function visit(v) {
    if (
      v === null ||
      (allowUndefined && v === undefined) ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return v;
    if (
      typeof v !== "object" ||
      seen.has(v) ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null) ||
      (allowUndefined && Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Array.prototype &&
        Object.getPrototypeOf(v) !== null)
    )
      throw widgetError("invalid_argument", "Use lossless plain JSON values.");
    seen.add(v);
    if (Object.getOwnPropertySymbols(v).length)
      throw widgetError("invalid_argument");
    // Serialize only validated own data. Sparse arrays must not read inherited
    // numeric getters, and inherited toJSON hooks must not run for state.
    const normalized = allowUndefined
      ? (Array.isArray(v) ? Object.setPrototypeOf(new Array(v.length), null) : Object.create(null))
      : null;
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && k === "length") continue;
      if (!d.enumerable || !Object.hasOwn(d, "value"))
        throw widgetError("invalid_argument");
      const data = visit(d.value);
      if (normalized) normalized[k] = data;
    }
    if (Array.isArray(v)) {
      const keys = Object.keys(v);
      if ((!allowUndefined && keys.length !== v.length) ||
          keys.some(k => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= v.length))
        throw widgetError("invalid_argument");
    }
    seen.delete(v);
    return normalized ?? v;
  }
  return JSON.stringify(visit(value));
}
export function validateWidgetState(v) {
  if (!v || Array.isArray(v) || typeof v !== "object")
    throw widgetError("invalid_argument", "State must be a JSON object.");
  const json = plainJSON(v, { allowUndefined: true });
  if (Buffer.byteLength(json) > WIDGET_LIMITS.stateBytes)
    throw widgetError("state_too_large");
  return json;
}
export function normalizeWidgetState(value) {
  return JSON.parse(validateWidgetState(value));
}
export function assertActionName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    Buffer.byteLength(name) > 64 ||
    HOOKS.has(name) ||
    name.startsWith("__") ||
    ["__proto__", "constructor", "prototype", "then"].includes(name)
  )
    throw widgetError("invalid_argument", "Invalid or reserved action name.");
  return name;
}
// Preserve full callback strings in the registry; only dispatch uses the prefix.
// null is a controller-only acknowledgement, never a sandbox action.
export function widgetCallbackAction(data) {
  if (typeof data !== "string" || !data || Buffer.byteLength(data) > 64)
    throw widgetError("invalid_argument", "Callback data must contain 1-64 UTF-8 bytes.");
  if (data === "void") return null;
  const separator = data.indexOf(":");
  const name = separator < 0 ? data : data.slice(0, separator);
  if (name === "void")
    throw widgetError("invalid_argument", "void cannot have a callback payload.");
  return assertActionName(name);
}
export function validateWidgetEvent(event, { control = false } = {}) {
  const hook = {
    reply: "onReply",
    reaction: "onReaction",
    poll: "onPoll",
    poll_answer: "onPollAnswer",
  }[event.source];
  if (
    event.name !== hook &&
    !(control && event.source === "agent" && event.name === "__render")
  )
    assertActionName(event.name);
  if (
    ![
      "button",
      "reply",
      "reaction",
      "poll",
      "poll_answer",
      "agent",
      "widget",
      "local",
    ].includes(event.source) ||
    typeof event.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(event.receivedAt)) ||
    typeof event.delayed !== "boolean"
  )
    throw widgetError("invalid_argument");
  const json = plainJSON(event);
  if (Buffer.byteLength(json) > WIDGET_LIMITS.eventBytes)
    throw widgetError("event_too_large");
  return json;
}
const createFields = [
  "topicId",
  "reply_parameters",
  "disable_notification",
  "protect_content",
  "message_effect_id",
];
export function validateSetWidget(args, record) {
  if (!args || Array.isArray(args) || typeof args !== "object")
    throw widgetError("invalid_argument");
  const allowed = new Set([
    "widgetId",
    "messageId",
    "chatId",
    "handler",
    "description",
    "state",
    ...createFields,
  ]);
  if (
    Object.keys(args).some((k) => !allowed.has(k)) ||
    (args.widgetId !== undefined &&
      ["messageId", "chatId", ...createFields].some(
        (k) => args[k] !== undefined,
      ))
  )
    throw widgetError("invalid_argument", "Ambiguous or unknown fields.");
  for (const k of ["messageId", "topicId"])
    if (
      args[k] !== undefined &&
      (!Number.isSafeInteger(args[k]) || args[k] < 1)
    )
      throw widgetError("invalid_argument");
  if (args.chatId !== undefined && !Number.isSafeInteger(args.chatId))
    throw widgetError("invalid_argument");
  if (
    args.widgetId !== undefined &&
    (typeof args.widgetId !== "string" || !args.widgetId)
  )
    throw widgetError("invalid_argument");
  if (args.messageId !== undefined || record)
    if (createFields.some((k) => args[k] !== undefined))
      throw widgetError(
        "invalid_argument",
        "Creation options cannot change an existing message.",
      );
  if (
    args.handler !== undefined &&
    (typeof args.handler !== "string" ||
      /[\r\n\0]/.test(args.handler) ||
      !/\.(?:tsx?|jsx?|mjs|cjs)$/.test(args.handler))
  )
    throw widgetError(
      "invalid_argument",
      "handler must be a path to a .ts/.tsx/.js/.jsx/.mjs/.cjs file. First write the file in the bot workspace, then pass its path; not inline source code.",
    );
  if (!record || record.status === "active" || args.handler !== undefined) {
    if (
      typeof args.handler !== "string" ||
      !args.handler ||
      typeof args.description !== "string" ||
      !args.description.trim() ||
      args.description.length > 1000
    )
      throw widgetError(
        "invalid_argument",
        "Handler and description are required.",
      );
  }
  if (
    args.description !== undefined &&
    (typeof args.description !== "string" ||
      !args.description.trim() ||
      args.description.length > 1000)
  )
    throw widgetError("invalid_argument");
  if (args.state !== undefined) validateWidgetState(args.state);
  for (const k of ["disable_notification", "protect_content"])
    if (args[k] !== undefined && typeof args[k] !== "boolean")
      throw widgetError("invalid_argument");
  if (
    args.message_effect_id !== undefined &&
    typeof args.message_effect_id !== "string"
  )
    throw widgetError("invalid_argument");
  if (args.reply_parameters !== undefined) plainJSON(args.reply_parameters);
  return args;
}
const obj = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" },
  integer = { type: "integer" },
  state = { type: "object", additionalProperties: true };
export const WIDGET_TOOL_SCHEMAS = {
  set_widget: obj({
    widgetId: str,
    messageId: integer,
    chatId: integer,
    handler: {
      type: "string",
      description:
        "Path to an existing .ts/.tsx/.js/.jsx/.mjs/.cjs module in the bot workspace, e.g. widgets/counter.tsx. Write the file first with exec_command/apply_patch. Do not pass source code here.",
    },
    description: str,
    state,
    topicId: integer,
    reply_parameters: state,
    disable_notification: { type: "boolean" },
    protect_content: { type: "boolean" },
    message_effect_id: str,
  }),
  delete_widget: obj({ widgetId: str }, ["widgetId"]),
  widgets: obj({}),
  widget_state: obj({ widgetId: str }, ["widgetId"]),
  widget_event: obj({ widgetId: str, name: str, data: {} }, [
    "widgetId",
    "name",
  ]),
  render_widget: obj({ widgetId: str, state }, ["widgetId"]),
};
export function publicWidget(w) {
  const keys = [
    "widgetId",
    "description",
    "status",
    "chatId",
    "messageId",
    "topicId",
    "disabledReason",
    "pending",
    "dropped",
  ];
  return Object.fromEntries(
    keys.filter((k) => w[k] !== undefined).map((k) => [k, w[k]]),
  );
}
