export class Pollers {
  constructor(run, onError = () => {}) { this.run = run; this.onError = onError; this.entries = new Map(); this.closed = false; }
  start(id) {
    if (this.closed || this.entries.has(id)) return false;
    const abort = new AbortController();
    const entry = { abort };
    this.entries.set(id, entry);
    entry.job = (async () => {
      try { await this.run(id, abort.signal); }
      catch (error) { this.onError(error); }
      finally { if (this.entries.get(id) === entry) this.entries.delete(id); }
    })();
    return true;
  }
  async remove(id) { const entry = this.entries.get(id); if (!entry) return; entry.abort.abort(); await entry.job; }
  async wait() { while (this.entries.size) await Promise.all([...this.entries.values()].map(entry => entry.job)); }
  async close() { this.closed = true; for (const entry of this.entries.values()) entry.abort.abort(); await this.wait(); }
}
