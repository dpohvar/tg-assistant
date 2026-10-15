// Deterministic external-effect boundary for an opt-in live model probe.
export function acceptanceSend({ invoke, chatId, marker }) {
  let used = false;
  return async (name, args = {}) => {
    if (
      name !== "send" ||
      used ||
      Object.keys(args).some(
        (k) => !["text", "chatId", "disable_notification"].includes(k),
      ) ||
      typeof args.text !== "string" ||
      ![marker, marker + "."].includes(args.text.trim()) ||
      (args.chatId !== undefined && args.chatId !== chatId) ||
      args.disable_notification !== true
    ) {
      return {
        error: "acceptance_scope",
        description:
          "This acceptance phase permits one notification-free plain-text marker send to the designated test chat only.",
      };
    }
    used = true; // Uncertain delivery must also consume the effect budget.
    return invoke("send", { text: marker, chatId, disable_notification: true });
  };
}
