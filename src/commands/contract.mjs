import { syntaxError } from "./arguments.mjs";
export const sections = [
  "vault", "ws",
  "agent",
  "task",
  "chat",
  "user",
  "owner",
  "rules",
  "triggers",
  "git",
  "file",
  "temp",
  "bot",
];
export function parseTarget(parts, { star = false } = {}) {
  if (!parts.length) return { kind: "current" };
  if (star && parts.length === 1 && parts[0] === "*") return { kind: "all" };
  if (parts.length === 1) return { kind: "agent", id: parts[0] };
  if (
    parts.length === 2 &&
    parts[0] === "in" &&
    /^-?\d+$/.test(parts[1]) &&
    Number.isSafeInteger(Number(parts[1])) &&
    Number(parts[1]) !== 0
  )
    return { kind: "chat", id: Number(parts[1]) };
  throw syntaxError("Invalid target.");
}
export function pagination(parts) {
  let range;
  if (/^\d+(?:-\d+)?$/.test(parts[0] ?? "")) range = parts.shift();
  return range;
}
export function commandError(section, message) {
  return `${message}\n/help${sections.includes(section) ? " " + section : ""}`;
}
