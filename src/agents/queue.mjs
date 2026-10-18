export class AgentQueue {
  states = new Map(); jobs = new Set(); agentJobs = new Map();
  constructor({ dispatch, steer, onError = () => {}, onDropped = () => {} }) { Object.assign(this, { dispatch, steer, onError, onDropped }); }
  state(id) { if (!this.states.has(id)) this.states.set(id, { events: [], busy: false, waiting: false, sending: false }); return this.states.get(id); }
  admitted(id, item) { if (!item.admit || item.admit()) return true; this.onDropped(id, item.event, item.source); return false; }
  pending(id) { return this.state(id).events.length; }
  canAccept(id) { const s = this.state(id); s.events = s.events.filter(e => this.admitted(id, e)); return s.events.filter(e => e.source === 'chat').length < 10; }
  enqueue(id, event, source, admit) {
    if (this.closed) return 'full';
    if (source === 'chat' && !this.canAccept(id)) return 'full';
    this.state(id).events.push({ event, source, admit }); this.pump(id); return 'accepted';
  }
  enqueueCommitted(id,event,source,admit,commit) {
    if(this.closed||source==='chat'&&!this.canAccept(id))return 'full';
    const item={event,source,admit};if(!this.admitted(id,item))return 'full';
    const state=this.state(id);state.events.push(item);
    try {const result=commit();if(result?.then)throw new Error('Queue commit must be synchronous.');}
    catch(error){state.events.splice(state.events.indexOf(item),1);throw error;}
    this.pump(id);return 'accepted';
  }
  cancelWhere(id,predicate) {
    const state=this.state(id),removed=state.events.filter(item=>predicate(item.event,item.source));
    state.events=state.events.filter(item=>!removed.includes(item));
    for(const item of removed)this.onDropped(id,item.event,item.source);return removed.length;
  }
  setHeld(id, key, value) { const s = this.state(id); s.holds ??= new Set(); value ? s.holds.add(key) : s.holds.delete(key); this.pump(id); }
  setPaused(id, value) { this.state(id).paused = value; this.pump(id); }
  setWaiting(id, value) { this.state(id).waiting = value; this.pump(id); }
  clear(id) { const s = this.state(id); for (const item of s.events) this.onDropped(id, item.event, item.source); s.events = []; }
  track(promise, id) { this.jobs.add(promise); if (id !== undefined) { if (!this.agentJobs.has(id)) this.agentJobs.set(id, new Set()); this.agentJobs.get(id).add(promise); } promise.finally(() => { this.jobs.delete(promise); this.agentJobs.get(id)?.delete(promise); }).catch(() => {}); }
  pump(id) {
    if (this.closed) return;
    const s = this.state(id);
    if (s.paused || s.holds?.size || !s.events.length || s.sending || s.busy && (!s.waiting || !this.steer)) return;
    const items = s.events.splice(0).filter(x => this.admitted(id, x));
    const events = items.flatMap(x => Array.isArray(x.event) ? x.event : [x.event]);
    if (!events.length) return;
    if (s.busy) {
      s.sending = true; s.waiting = false;
      this.track(Promise.resolve().then(() => { if (!s.busy) { s.events.unshift(...items); return; } const current=items.filter(item=>this.admitted(id,item)).flatMap(item=>Array.isArray(item.event)?item.event:[item.event]);if(current.length)return this.steer(id, current); }).catch(async error => { if (error.code === 'steer_expired') { s.events.unshift(...items); return; } if (error.code !== 'rules_replaced') this.clear(id); await this.onError(id, error); }).finally(() => { s.sending = false; this.pump(id); }), id);
    } else {
      s.busy = true;
      this.track(Promise.resolve().then(() => {const current=items.filter(item=>this.admitted(id,item)).flatMap(item=>Array.isArray(item.event)?item.event:[item.event]);if(current.length)return this.dispatch(id,current);}).catch(async error => { if (error.code !== 'rules_replaced') this.clear(id); await this.onError(id, error); }).finally(() => { s.busy = false; s.waiting = false; this.pump(id); }), id);
    }
  }
  async idleAgent(id) { while (this.agentJobs.get(id)?.size) await Promise.allSettled([...this.agentJobs.get(id)]); }
  async idle() { while (this.jobs.size) await Promise.allSettled([...this.jobs]); }
  close() { this.closed = true; for (const s of this.states.values()) s.events = []; }
}
