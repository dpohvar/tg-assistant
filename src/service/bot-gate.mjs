export class BotGate {
  held = new Set(); jobs = new Map(); scoped = new Map();
  async run(id, fn, scopeId) {
    if (this.held.has(id)) throw new Error('Bot directory maintenance is in progress. Try again later.');
    if (!this.jobs.has(id)) this.jobs.set(id, new Set());
    const jobs = this.jobs.get(id), promise = Promise.resolve().then(fn);
    jobs.add(promise);
    if (scopeId) { if (!this.scoped.has(scopeId)) this.scoped.set(scopeId, new Set()); this.scoped.get(scopeId).add(promise); }
    try { return await promise; } finally { jobs.delete(promise); this.scoped.get(scopeId)?.delete(promise); }
  }
  async idleScope(id) { while (this.scoped.get(id)?.size) await Promise.allSettled([...this.scoped.get(id)]); this.scoped.delete(id); }
  async idle() { while ([...this.jobs.values()].some(jobs => jobs.size)) await Promise.allSettled([...this.jobs.values()].flatMap(jobs => [...jobs])); }
  async acquire(id, pause) {
    if (this.held.has(id)) throw new Error('Bot directory maintenance is in progress. Try again later.');
    this.held.add(id);
    try { await pause(); while (this.jobs.get(id)?.size) await Promise.allSettled([...this.jobs.get(id)]); }
    catch (error) { this.held.delete(id); throw error; }
    return () => this.held.delete(id);
  }
}
