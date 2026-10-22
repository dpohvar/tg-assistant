import {createControlStore} from './control-store.mjs';
import {createWorkStore} from './work.mjs';
const error=(code,message)=>Object.assign(new Error(message),{code,safe:true});
export function createAgentControl({db,queue,agent,notify=async()=>{},onResume=()=>{},invalidate=()=>{},settle=()=>{},idleEffects=async()=>{},effectsActive=()=>false,clock=Date.now}) {
 const store=createControlStore(db,{now:clock}),work=createWorkStore(db,{now:clock}),jobs=new Map(),active=new Map();let closed=false,recovering=false;
 const record=id=>db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(id);
 const status=id=>({...store.read(id),compact:store.active(id)?.phase??null});
 const hold=id=>{const phase=store.read(id)?.phase;queue.setHeld(id,'cancel',['paused','cancelling','unknown'].includes(phase));};
 const finishWork=(id,outcome)=>{const row=work.get(id);if(row&&work.finish(id,outcome))settle(row,outcome);};
 const track=(id,fn)=>{if(jobs.has(id))return jobs.get(id);const job=Promise.resolve().then(fn).catch(e=>{if(!closed&&record(id))store.patch(id,{phase:'unknown'});hold(id);}).finally(()=>{if(jobs.get(id)===job)jobs.delete(id);});jobs.set(id,job);return job;};
 const continuation=op=>{if(closed||op.continuationPhase!=='pending'||op.invalidated)return;onResume(op.agentId,op);};
 const kick=id=>{
  if(closed||recovering||jobs.has(id))return jobs.get(id);
  const c=store.read(id),op=store.active(id);if(!op||op.phase!=='queued'||c&&c.phase!=='running')return;
  if(queue.active(id)||queue.state(id).activeJobs.size||effectsActive(id)||agent.hasBackground?.(id)||queue.state(id).events.some(e=>e.seq<=op.boundary))return;
  return track(id,async()=>{
   queue.setHeld(id,'compact',true);
   const a=record(id);if(!a||op.invalidated)return;
   if(!store.transition(op.operationId,'queued',{phase:'submitting',threadId:a.threadId}))return;
   let evidence;try{evidence=await agent.compact(a,{operationId:op.operationId,onProgress:identity=>store.transition(op.operationId,['submitting','running'],{phase:'running',...identity})});}catch(e){evidence={state:'unknown',code:e.code??'compact_failed'};}
   const current=store.operation(op.operationId);if(!record(id)||closed)return;
   const phase=evidence.state==='completed'?'succeeded':evidence.state==='unknown'?'unknown':'failed';
   store.transition(op.operationId,['submitting','running'],{phase,code:evidence.code??null,...evidence.identity,...(phase==='failed'?{continuationPhase:'cancelled'}:{})});
   if(phase==='succeeded'){agent.context?.invalidate(id,'compact');const done=store.operation(op.operationId);if(done.epoch===store.read(id)?.epoch)continuation(done);}
   else if(op.workId&&phase==='failed')finishWork(op.workId,'failed');
   await notify(store.operation(op.operationId),phase==='succeeded'?'Context compacted.':`Compaction ${phase}.`);
   queue.setBoundary(id,'compact',null);queue.setHeld(id,'compact',phase==='unknown');
  });
 };
 const api={store,work,status,kick,
  reply:(target,text)=>notify({replyTarget:target},text),
  admitted(id,item){if(recovering||item.recovery||item.source==='control')return;const c=store.read(id);if(!c||c.phase==='running')return;if(c.phase==='cancelling')store.patch(id,{wake:1});else if(c.phase==='paused'){store.wake(id);hold(id);}},
  start(scope){const c=store.read(scope.agentId);if(c?.phase==='paused'){store.wake(scope.agentId);hold(scope.agentId);return true;}if(c?.phase==='cancelling')store.patch(scope.agentId,{wake:1});return false;},
  cancel(scope,{replyTarget}={}){
   const id=scope.agentId,a=record(id);if(!a||!db.getChat(a.botId,a.chatId)?.agentEnabled)return {status:'unavailable'};
   const c=store.read(id);if(c?.phase==='cancelling')return {status:'already_pending'};
   if(c?.phase==='unknown')return {status:'unknown'};
   if(c?.phase==='paused'){store.patch(id,{wake:0});return {status:'already_pending'};}
   const op=store.active(id);store.invalidate(id,'cancel');
   store.patch(id,{phase:'cancelling',wake:0,notice:{eventType:'agent_cancelled',workIds:work.open(id).map(w=>w.workId),interruptedTurnIds:work.open(id).flatMap(w=>w.turns??[]).map(t=>t.turnId)}});hold(id);invalidate(id);
   const previous=jobs.get(id);
   const cancelJob=async()=>{
    if(previous)await previous;
    if(closed||!record(id))return;
    let evidence;if(op&&['submitting','running','unknown'].includes(op.phase)){const after=store.operation(op.operationId);evidence={state:after.phase==='unknown'?'unknown':'interrupted'};}else evidence=await agent.interrupt?.(id)??{state:'unknown'};
    if(evidence.state==='interrupted'){await queue.idleActive(id);await idleEffects(id);for(const w of work.open(id))finishWork(w.workId,'cancelled');const woke=store.read(id)?.wake;store.patch(id,{phase:woke?'running':'paused',wake:0});}
    else store.patch(id,{phase:'unknown'});
    hold(id);queue.setBoundary(id,'compact',null);if(store.active(id)?.phase!=='unknown')queue.setHeld(id,'compact',false);
    await notify({agentId:id,replyTarget},store.read(id)?.phase==='paused'?'Work cancelled. Queue paused until the next event.':store.read(id)?.phase==='running'?'Work cancelled. Queue resumed.':'Cancellation outcome unknown. Queue held.');
   };
   // A running compact finishes first; do not replace or await our own job.
   const job=Promise.resolve().then(cancelJob).catch(()=>{if(record(id)){store.patch(id,{phase:'unknown'});hold(id);}}).finally(()=>{if(jobs.get(id)===job)jobs.delete(id);});jobs.set(id,job);
   return {status:'accepted'};
  },
  requestCompact(scope,request){
   if(request.continuation!==undefined&&(typeof request.continuation!=='string'||!request.continuation.trim()||[...request.continuation].length>4096))throw error('invalid_argument','continuation must be a nonempty string of at most 4096 characters.');
   const id=scope.agentId,a=record(id);if(!a?.threadId||!db.getChat(a.botId,a.chatId)?.agentEnabled)return {status:'unavailable'};
   if(scope.threadId&&scope.threadId!==a.threadId)throw error('root_only','Only the root thread may request compaction.');
   const old=store.active(id);if(old){if(request.continuation&&old.continuation!==request.continuation)throw error('already_pending','Compaction already pending with a different continuation.');return {status:'already_pending',operationId:old.operationId};}
   if(store.read(id)?.phase&&store.read(id).phase!=='running')return {status:'unavailable'};
   const boundary=request.kind==='manual'?queue.captureBoundary(id):0;
   const priorWork=work.get(scope.workId??active.get(id));if(priorWork?.operationId){const prior=store.operation(priorWork.operationId);if(prior?.continuationPhase==='accepted')store.transition(prior.operationId,prior.phase,{continuationPhase:'completed'});}
   const op=store.requestCompact(id,{...request,boundary,workId:scope.workId??active.get(id)});
   queue.setBoundary(id,'compact',boundary);if(op.workId&&request.continuation)work.suspend(op.workId,op.operationId);kick(id);
   return {status:'accepted',operationId:op.operationId,...(request.kind==='agent'?{finishTurn:true}:{})};
  },
  beforeWork(scope,events,{activeWorkId}={}){
   const resume=events.find(e=>e._compactOperation);let id;
   if(resume){const op=store.operation(resume._compactOperation);if(!op||op.phase!=='succeeded'||op.continuationPhase!=='pending'||op.invalidated||op.epoch!==store.read(scope.agentId)?.epoch)throw error('agent_cancelled','Continuation expired.');store.transition(op.operationId,'succeeded',{continuationPhase:'submitting'});id=op.workId;events=events.map(e=>e===resume?{eventType:'context_status',continuation:op.continuation}:e);if(id)work.resume(id);}
   const origins=events.flatMap(e=>e.eventType==='scheduled'?[{taskId:e.taskId}]:e.eventType==='agent_message'?[{senderId:e.from.agentId}]:[]);
   id??=activeWorkId??work.begin(scope,origins);if(activeWorkId||resume)work.addOrigins(id,origins);active.set(scope.agentId,id);
   const notice=store.takeNotice(scope.agentId);if(notice)events=[...events.filter(e=>e.eventType==='context_status'),notice,...events.filter(e=>e.eventType!=='context_status')];
   return {workId:id,events};
  },
  bound(id,workId,identity){if(workId)work.bindTurn(workId,identity);const operationId=work.get(workId)?.operationId;const op=operationId?store.operation(operationId):null;if(op?.workId===workId&&op.phase==='succeeded'&&op.continuationPhase==='submitting'&&identity.threadId===record(id)?.threadId)store.transition(op.operationId,'succeeded',{continuationPhase:'accepted',continuationIdentity:identity});},
  afterWork(id,{outcome='completed',settled}={}){
   const row=work.get(id);if(!row)return Promise.resolve();
   const done=Promise.resolve(settled).then(()=>{
    const op=store.active(row.agentId);if(active.get(row.agentId)===id)active.delete(row.agentId);
    if(op?.workId===id&&op.phase==='queued'&&op.continuation&&outcome==='completed')work.suspend(id,op.operationId);else finishWork(id,outcome);
    const previous=row.operationId?store.operation(row.operationId):null;
    if(previous&&['accepted','submitting'].includes(previous.continuationPhase))store.transition(previous.operationId,previous.phase,{continuationPhase:outcome==='completed'?'completed':'cancelled'});
    if(outcome!=='completed'&&op?.phase==='queued'){store.transition(op.operationId,'queued',{phase:'failed',continuationPhase:'cancelled',code:'precondition_failed'});queue.setBoundary(row.agentId,'compact',null);}
   }).catch(e=>{const cancelled=['cancelling','paused','unknown'].includes(store.read(row.agentId)?.phase);finishWork(id,cancelled?'cancelled':'failed');if(cancelled)e=Object.assign(new Error('Work cancelled.'),{code:'agent_cancelled'});throw e;}).finally(()=>{kick(row.agentId);});return done;
  },
  activeWork:id=>active.get(id),
  suspended(scope){const op=store.active(scope.agentId);return op?.kind==='agent'&&op.workId===scope.workId&&['queued','submitting','running'].includes(op.phase);},
  invalidate(id,reason){store.invalidate(id,reason);const op=store.active(id);if(!op||op.phase==='queued'||op.phase==='cancelled'){queue.setBoundary(id,'compact',null);queue.setHeld(id,'compact',false);}},
  retired(id){for(const op of store.pending().filter(o=>o.agentId===id))store.transition(op.operationId,op.phase,{phase:'cancelled',continuationPhase:'cancelled'});for(const unit of work.open(id))finishWork(unit.workId,'cancelled');if(store.read(id)?.phase==='unknown')store.patch(id,{phase:'paused'});queue.setBoundary(id,'compact',null);queue.setHeld(id,'compact',false);hold(id);},
  async idleAgent(id){await jobs.get(id);},
  async recover(){recovering=true;try{
   for(const c of db.sql.prepare('SELECT * FROM agent_control').all()){if(c.phase==='cancelling')store.patch(c.agentId,{phase:'unknown'});hold(c.agentId);}
   for(const op of store.pending()){
    if(op.phase==='queued'){queue.setBoundary(op.agentId,'compact',0);continue;}
    if(['submitting','running','unknown'].includes(op.phase)){queue.setHeld(op.agentId,'compact',true);const evidence=await agent.reconcileControl?.(record(op.agentId),op)??{state:'unknown'};const phase=evidence.state==='completed'?'succeeded':['failed','interrupted'].includes(evidence.state)?'failed':'unknown';store.transition(op.operationId,op.phase,{phase,...(phase==='failed'?{continuationPhase:'cancelled'}:{})});if(phase==='failed'&&op.workId)finishWork(op.workId,'failed');queue.setHeld(op.agentId,'compact',evidence.state==='unknown');}
    const current=store.operation(op.operationId);if(current.phase==='succeeded'&&current.continuationPhase==='pending')continuation(current);else if(['submitting','accepted','unknown'].includes(current.continuationPhase)){
      let evidence=current.continuationIdentity?await agent.reconcileControl?.(record(op.agentId),current.continuationIdentity):null;
      if(evidence?.state==='completed'&&current.workId){const unit=work.get(current.workId);for(const identity of unit?.turns??[]){const terminal=await agent.reconcileControl?.(record(op.agentId),identity);if(terminal?.state!=='completed'){evidence={state:terminal?.state??'unknown'};break;}}}
      if(['completed','interrupted','failed'].includes(evidence?.state)){store.transition(current.operationId,current.phase,{continuationPhase:evidence.state==='completed'?'completed':'cancelled'});if(current.workId)finishWork(current.workId,evidence.state==='completed'?'completed':'failed');}
      else {store.transition(current.operationId,current.phase,{continuationPhase:'unknown'});queue.setHeld(op.agentId,'compact',true);}
    }
   }
  }finally{recovering=false;for(const op of store.pending())kick(op.agentId);}},
  async idle(){while(jobs.size)await Promise.allSettled([...jobs.values()]);},
  async close(){closed=true;await api.idle();}
 };
 return api;
}
