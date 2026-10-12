import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { widgetError } from "./contract.mjs";
export function trackTree(rows, tracked) {
  const selected = new Map();
  for (const r of rows)
    if (tracked.get(r.pid) === r.start) selected.set(r.pid, r);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows)
      if (!selected.has(r.pid) && selected.has(r.ppid)) {
        selected.set(r.pid, r);
        tracked.set(r.pid, r.start);
        changed = true;
      }
  }
  return [...selected.values()];
}
function linuxProcesses() {
  const rows = [];
  for (const p of fs.readdirSync("/proc"))
    if (/^\d+$/.test(p)) {
      try {
        const stat = fs.readFileSync(`/proc/${p}/stat`, "utf8"),
          fields = stat.slice(stat.lastIndexOf(")") + 2).split(" "),
          status = fs.readFileSync(`/proc/${p}/status`, "utf8");
        rows.push({
          pid: +p,
          ppid: +fields[1],
          start: fields[19],
          bytes: +(/VmRSS:\s*(\d+)/.exec(status)?.[1] ?? 0) * 1024,
        });
      } catch (e) {
        if (!["ENOENT", "ESRCH", "EACCES"].includes(e.code)) throw e;
      }
    }
  return rows;
}
export function createProcessMonitor({
  dataDir,
  platform = process.platform,
} = {}) {
  let helper,
    lines,
    waiters = [],
    dead = false;
  if (platform === "win32") {
    const dir = path.join(dataDir, "widget-monitor");
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, "monitor.exe"),
      source = fs.readFileSync(
        new URL("./windows-monitor.cs", import.meta.url),
      );
    const cs = path.join(dir, "monitor.cs");
    if (
      !fs.existsSync(exe) ||
      !fs.existsSync(cs) ||
      !fs.readFileSync(cs).equals(source)
    ) {
      fs.writeFileSync(cs, source);
      const csc = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "Microsoft.NET",
        "Framework64",
        "v4.0.30319",
        "csc.exe",
      );
      execFileSync(csc, ["/nologo", "/out:" + exe, cs], {
        windowsHide: true,
        timeout: 20000,
        stdio: "pipe",
      });
    }
    helper = spawn(exe, [], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    lines = createInterface({ input: helper.stdout });
    lines.on("line", (line) => {
      const p = waiters.shift();
      if (p)
        try {
          p.resolve(JSON.parse(line));
        } catch {
          p.reject(
            widgetError(
              "sandbox_unavailable",
              "Memory monitor invalid response.",
            ),
          );
        }
    });
    const fail = () => {
      dead = true;
      for (const p of waiters.splice(0))
        p.reject(widgetError("sandbox_unavailable", "Memory monitor exited."));
    };
    helper.on("error", fail);
    helper.on("exit", fail);
    helper.stdin.on("error", fail);
  }
  async function all() {
    if (platform === "linux") return linuxProcesses();
    if (platform !== "win32" || dead)
      throw widgetError(
        "sandbox_unavailable",
        "OS memory monitor unavailable.",
      );
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      helper.stdin.write("sample\n");
    });
  }
  return {
    async identity(pid) {
      const r = (await all()).find((x) => x.pid === pid);
      if (!r || !r.start || r.bytes < 0)
        throw widgetError(
          "sandbox_unavailable",
          "Runtime process identity unavailable.",
        );
      return { pid, start: r.start, tracked: new Map([[pid, r.start]]) };
    },
    async measureTree(identity) {
      const rows = trackTree(await all(), identity.tracked);
      if (rows.some((r) => r.bytes < 0 || !r.start))
        throw widgetError(
          "sandbox_unavailable",
          "Runtime descendant cannot be monitored.",
        );
      return { bytes: rows.reduce((n, r) => n + r.bytes, 0), processes: rows };
    },
    async terminateTree(identity) {
      if (!identity) return;
      const rows = trackTree(await all(), identity.tracked).reverse();
      if (platform === "linux") {
        try {
          process.kill(-identity.pid, "SIGKILL");
        } catch {}
        for (const r of rows) {
          try {
            const latest = linuxProcesses().find((x) => x.pid === r.pid);
            if (latest?.start === r.start) process.kill(r.pid, "SIGKILL");
          } catch {}
        }
      } else {
        for (const r of rows)
          if (!dead)
            await new Promise((resolve, reject) => {
              waiters.push({ resolve, reject });
              helper.stdin.write(`kill ${r.pid} ${r.start}\n`);
            });
      }
    },
    close() {
      dead = true;
      lines?.close();
      helper?.kill();
      for (const p of waiters.splice(0))
        p.reject(widgetError("widget_stopped"));
    },
  };
}
