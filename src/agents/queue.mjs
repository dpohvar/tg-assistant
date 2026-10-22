import {randomUUID} from 'node:crypto';
export class AgentQueue {
  states = new Map(); jobs = new Set(); agentJobs = new Map(); batchTimers = new Map();
  constructor({ dispatch, steer, onError = () => {}, onDropped = () => {}, onEvicted=()=>{},onAdmitted=()=>{},onDispatched=()=>{},onStateChanged = () => {} }) { Object.assign(this, { dispatch, steer, onError, onDropped,onEvicted,onAdmitted,onDispatched, onStateChanged }); }
  state(id) { if (!this.states.has(id)) this.states.set(id, { events: [], busy: false, waiting: false, sending: false,serial:0,boundaries:new Map(),activeJobs:new Set() }); return this.states.get(id); }
  canStart(id,seq) { const s = this.state(id);seq??=s.events[0]?.seq??s.serial+1;return !this.closed && !s.paused && !s.holds?.size && [...s.boundaries.values()].every(n=>seq<=n) && !s.sending && (!s.busy || s.waiting && Boolean(this.steer)) && (!s.events.length || s.events[0].readyAt <= Date.now()); }
  admitted(id, item) { if (!item.admit || item.admit()) return true; this.onDropped(id, item.event, item.source); return false; }
  pending(id) { return this.state(id).events.length; }
  canAccept() {return !this.closed;}
  captureBoundary(id){return this.state(id).serial;}
  setBoundary(id,key,seq){const s=this.state(id);seq===null?s.boundaries.delete(key):s.boundaries.set(key,seq);this.pump(id);}
  active(id){const s=this.state(id);return s.busy||s.sending;}
  async idleActive(id){const s=this.state(id);while(s.activeJobs.size)await Promise.allSettled([...s.activeJobs]);}
  enqueue(id, event, source, admit,options) {
    return this.enqueueCommitted(id,event,source,admit,()=>{},options);
  }
  enqueueCommitted(id,event,source,admit,commit,options={}) {
    if(this.closed)return 'full';
    const state=this.state(id),seq=state.serial+1,item={id:randomUUID(),seq,event,source,admit,readyAt:state.events[0]?.readyAt ?? Date.now()+200};if(!this.admitted(id,item))return 'full';
    state.events.push(item);
    try{const result=commit({id:item.id,seq});if(result?.then)throw new Error('Queue commit must be synchronous.');}catch(e){state.events.splice(state.events.indexOf(item),1);throw e;}
    state.serial=seq;
    let removed;if(source==='chat'&&state.events.filter(x=>x.source==='chat').length>10){const index=state.events.findIndex(x=>x.source==='chat');[removed]=state.events.splice(index,1);}
    this.onAdmitted(id,{id:item.id,seq,source,recovery:!!options.recovery});if(removed)this.onEvicted(id,removed.event,removed.source,{id:removed.id,seq:removed.seq,reason:'overflow'});
    this.pump(id);return 'accepted';
  }
  cancelWhere(id,predicate) {
    const state=this.state(id),removed=state.events.filter(item=>predicate(item.event,item.source));
    state.events=state.events.filter(item=>!removed.includes(item));
    for(const item of removed)this.onDropped(id,item.event,item.source);if(!state.events.length)this.cancelBatch(id);this.onStateChanged(id);return removed.length;
  }
  setHeld(id, key, value) { const s = this.state(id); s.holds ??= new Set(); value ? s.holds.add(key) : s.holds.delete(key); this.pump(id); }
  setPaused(id, value) { this.state(id).paused = value; this.pump(id); }
  setWaiting(id, value) { this.state(id).waiting = value; this.pump(id); }
  clear(id) { const s = this.state(id); for (const item of s.events) this.onDropped(id, item.event, item.source); s.events = []; this.cancelBatch(id); this.onStateChanged(id); }
  cancelBatch(id) { const batch = this.batchTimers.get(id); if (!batch) return; clearTimeout(batch.timer); this.batchTimers.delete(id); batch.resolve(); }
  waitBatch(id, delay) {
    if (this.batchTimers.has(id)) return;
    const promise = new Promise(resolve => {
      const timer = setTimeout(() => { this.batchTimers.delete(id); try { this.pump(id); } finally { resolve(); } }, delay);
      this.batchTimers.set(id, {timer,resolve});
    });
    this.track(promise, id, true);
  }
  track(promise, id, timer=false) { this.jobs.add(promise); if (id !== undefined) { if (!this.agentJobs.has(id)) this.agentJobs.set(id, new Set()); this.agentJobs.get(id).add(promise);if(!timer)this.state(id).activeJobs.add(promise); } promise.finally(() => { this.jobs.delete(promise); this.agentJobs.get(id)?.delete(promise);this.state(id).activeJobs.delete(promise);this.onStateChanged(id); }).catch(() => {}); }
  pump(id) {
    if (this.closed) return;
    const s = this.state(id);
    try {
      if (!s.events.length) { this.cancelBatch(id); return; }
      if([...s.boundaries.values()].some(n=>s.events[0].seq>n)||s.holds?.size||s.paused){this.cancelBatch(id);return;}
      const delay = s.events[0].readyAt - Date.now();
      if (delay > 0) { this.waitBatch(id, delay); return; }
      this.cancelBatch(id);
      if (!this.canStart(id) || !s.events.length) return;
      const limit=Math.min(Infinity,...s.boundaries.values()),count=s.events.findIndex(x=>x.seq>limit);
      const items = s.events.splice(0,count<0?s.events.length:count).filter(x => this.admitted(id, x));
      const events = items.flatMap(x => Array.isArray(x.event) ? x.event : [x.event]);
      if (!events.length) return;
      if (s.busy) {
        s.sending = true; s.waiting = false;
        this.track(Promise.resolve().then(() => { if (!s.busy) { s.events.unshift(...items); return; } const current=items.filter(item=>this.admitted(id,item)).flatMap(item=>Array.isArray(item.event)?item.event:[item.event]);if(current.length)return Promise.resolve(this.steer(id,current)).then(result=>{for(const item of items)this.onDispatched(id,item);return result;}); }).catch(async error => { if (error.code === 'steer_expired') { s.events.unshift(...items); return; } if (!['rules_replaced','agent_cancelled'].includes(error.code)) this.clear(id); await this.onError(id, error); }).finally(() => { s.sending = false; this.pump(id); }), id);
      } else {
        s.busy = true;
        this.track(Promise.resolve().then(() => {const current=items.filter(item=>this.admitted(id,item)).flatMap(item=>Array.isArray(item.event)?item.event:[item.event]);if(current.length){for(const item of items)this.onDispatched(id,item);return this.dispatch(id,current);}}).catch(async error => { if (!['rules_replaced','agent_cancelled'].includes(error.code)) this.clear(id); await this.onError(id, error); }).finally(() => { s.busy = false; s.waiting = false; this.pump(id); }), id);
      }
    } finally { this.onStateChanged(id); }
  }
  async idleAgent(id) { while (this.agentJobs.get(id)?.size) await Promise.allSettled([...this.agentJobs.get(id)]); }
  async idle() { while (this.jobs.size) await Promise.allSettled([...this.jobs]); }
  close() { this.closed = true; for (const id of this.batchTimers.keys()) this.cancelBatch(id); for (const s of this.states.values()) s.events = []; }
}
