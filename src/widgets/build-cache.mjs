import { createHash } from "node:crypto";
import { widgetError } from "./contract.mjs";

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Content, not timestamps, controls reuse. The compiler still records mtimeNs for diagnostics. */
export function createBuildCache({ read }) {
  const entries = new Map(), pending = new Map();
  async function valid(result) {
    if (!result?.manifest?.length) return false;
    for (const item of result.manifest) {
      if (!item || typeof item.path !== "string" ||
          !/^[a-f0-9]{64}$/.test(item.contentHash))
        throw widgetError("sandbox_unavailable", "Invalid build manifest.");
      let bytes;
      try { bytes = await read(item.path); } catch { return false; }
      if (hashBytes(bytes) !== item.contentHash) return false;
    }
    return true;
  }
  return {
    async build(key,produce) {
      if (pending.has(key)) return pending.get(key);
      const task = (async () => {
        const old = entries.get(key);
        if (old && await valid(old)) return old;
        const next = await produce();
        if (!await valid(next)) throw widgetError("sandbox_unavailable", "Build inputs changed during compilation.");
        entries.set(key,next);
        return next;
      })();
      pending.set(key,task);
      try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
    },
    forget(key) { entries.delete(key); },
  };
}
