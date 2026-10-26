import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export function sandboxLaunchSpec(
  config,
  owner,
  assets,
  { platform = process.platform, entry = "runtime-react.mjs" } = {},
) {
  const cwd = path.join(config.botsDir, owner.botId),
    temp = path.join(cwd, ".temp", owner.agentId);
  const permissions = {
    ":minimal": "read",
    [cwd]: "write",
    [path.join(cwd, ".git")]: "deny",
    [path.join(cwd, ".temp")]: "deny",
    [temp]: "write",
    [assets]: "read",
    [path.dirname(process.execPath)]: "read",
    [path.dirname(config.codexExecutable)]: "read",
  };
  const toml =
    "{" +
    Object.entries(permissions)
      .map(([p, v]) => `${JSON.stringify(p)}=${JSON.stringify(v)}`)
      .join(",") +
    "}";
  const env = {};
  for (const k of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "LOCALAPPDATA",
    "LANG",
    "LC_ALL",
    "TZ",
  ])
    if (process.env[k]) env[k] = process.env[k];
  Object.assign(env, {
    HOME: temp,
    USERPROFILE: temp,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp,
  });
  const args = [
    "sandbox",
    ...(platform === "win32" ? ["--enable", "prefer_mxc"] : []),
    "-P",
    "tg-widget",
    "-c",
    'approval_policy="never"',
    "-c",
    'default_permissions="tg-widget"',
    "-c",
    `permissions.tg-widget.filesystem=${toml}`,
    "-c",
    "permissions.tg-widget.network={enabled=true}",
    "--",
    process.execPath,
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    path.join(assets, entry),
    "--widget-runtime",
  ];
  return { executable: config.codexExecutable, args, cwd, env, permissions };
}
export function launchSandbox(config, owner, assets, bootstrap, options) {
  const spec = sandboxLaunchSpec(config, owner, assets, options);
  fs.mkdirSync(path.join(spec.cwd, ".temp", owner.agentId), {
    recursive: true,
  });
  const git = path.join(spec.cwd, ".git");
  if (
    fs.existsSync(git) &&
    (!fs.lstatSync(git).isDirectory() || fs.lstatSync(git).isSymbolicLink())
  )
    throw new Error("Sandbox .git boundary must be a regular directory.");
  fs.mkdirSync(git, { recursive: true });
  const child = spawn(spec.executable, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  child.stdin.end(JSON.stringify(bootstrap) + "\n");
  return child;
}
