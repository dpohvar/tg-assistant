export class AlbumCollector {
  states = new Map(); activated = new Map();
  constructor({ onReady, clock = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) { Object.assign(this, { onReady, clock, setTimer, clearTimer }); }
  add(key, message, trigger) {
    this.cleanup();
    let s = this.states.get(key); if (!s) { s = { messages: [], trigger: false, first: this.clock() }; this.states.set(key, s); }
    s.messages.push(message); s.trigger ||= trigger; this.clearTimer(s.timer);
    s.timer = this.setTimer(() => { this.states.delete(key); const active = this.activated.has(key); if (this.onReady(s.messages, s.trigger, active)) this.activated.set(key, this.clock()); }, Math.min(1000, Math.max(0, s.first + 3000 - this.clock())));
  }
  cleanup() { for (const [key, at] of this.activated) if (at < this.clock() - 30 * 86400000) this.activated.delete(key); }
  close() { for (const s of this.states.values()) this.clearTimer(s.timer); this.states.clear(); this.activated.clear(); }
}
