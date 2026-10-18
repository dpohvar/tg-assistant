import {randomUUID} from 'node:crypto';
import {validateSetWidget,validateWidgetState,plainJSON,assertActionName,WIDGET_LIMITS as L,publicWidget,widgetError} from './contract.mjs';
import {widgetTarget,viewSnapshot} from './views.mjs';
import {viewLossReason} from './errors.mjs';

export function createWidgetManager({db,host,store,build,render,authorize,notify=async()=>{},snapshotPath=id=>id,assertInlineOwner=()=>{throw widgetError('inline_message_unknown');},ackCallback=async()=>{},recoverReceipts=()=>false,removeReceipts=()=>{}}) {
  const jobs=new Set(),locks=new Map(),hooks=new Map(),revoked=new Map(),cutoffs=new Map(),origins=new Map(),loaded=new Set(),reservations=new Map();
  let closed=false;
  const refKey=r=>`${r.widgetId}:${r.generation}`;
  const assertOpen=()=>{if(closed)throw widgetError('widget_stopped');};
  const own=(scope,id)=>{const w=store.get(id);if(!w||w.botId!==scope.botId||w.agentId!==scope.agentId||w.lifecycleIntent==='delete')throw widgetError('widget_not_found');return w;};
  const revoke=w=>revoked.set(w.widgetId,Math.max(w.generation,revoked.get(w.widgetId)??0));
  const track=p=>{jobs.add(p);p.finally(()=>jobs.delete(p)).catch(()=>{});return p;};
  async function locked(key,fn,{self=false}={}) {
    if(self)return fn();
    const previous=locks.get(key)??Promise.resolve(),job=previous.catch(()=>{}).then(fn);locks.set(key,job);
    try{return await job;}finally{if(locks.get(key)===job)locks.delete(key);}
  }
  function cutoff(id,delta){if(!id)return;const n=(cutoffs.get(id)??0)+delta;if(n)cutoffs.set(id,n);else cutoffs.delete(id);}
  function ackQueued(w){const ids=db.sql.prepare("SELECT json_extract(payload,'$.data.id') id FROM widget_events WHERE widgetId=? AND started=0 AND json_extract(payload,'$.source')='button'").all(w.widgetId);return Promise.allSettled(ids.filter(row=>row.id).map(row=>ackCallback(row.id,w)));}
  async function release(owner){if(!store.list(owner).some(w=>w.status==='active'&&!manager.isRevoked(w)))await host.release(owner);}
  async function retire(w,{self=false}={}) {
    loaded.delete(refKey(w));reservations.delete(refKey(w));
    revoke(w);if(!host.has(w))return;
    let timer;
    try {await Promise.race([host.request(w,'retire',{self}),new Promise((_,reject)=>timer=setTimeout(()=>reject(widgetError('widget_stopped','Cleanup timed out.')),L.teardownMs))]);}
    catch(error){await manager.failure(w,error);}
    finally{clearTimeout(timer);}
  }
  async function load(w) {
    await host.reserve(w);assertOpen();
    const result=await host.load(w,{state:w.state,snapshotPath:snapshotPath(w.snapshotId,w),viewMode:true});
    loaded.add(refKey(w));reservations.set(refKey(w),new Set());
    hooks.set(w.widgetId,result?.hooks??[]);
  }
  async function initialize(w,{first=false,quiet=true}={}) {
    try {await host.request(w,'hook',{name:'onInit'});}
    catch(cause) {
      const error=Object.assign(widgetError('widget_init_failed',String(cause.message)),{phase:'onInit',widgetId:w.widgetId,status:'stopped',causeCode:cause.code??'widget_failed'});
      await manager.error(w,error,undefined,{quiet});throw error;
    }
    if(first)await host.request(w,'hook',{name:'onCreate'});
  }
  async function restorePending(w) {
    for(const {seq}of db.sql.prepare('SELECT seq FROM widget_events WHERE widgetId=? AND started=0 ORDER BY seq').all(w.widgetId)) {
      if(reservations.get(refKey(w))?.has(seq))continue;
      const id=randomUUID();if(!await host.request(w,'reserveEvent',{id}))break;
      reservations.get(refKey(w))?.add(seq);
      await host.request(w,'commitEvent',{id,token:seq});
    }
  }
  async function schedule(w,admit) {
    if(w.status!=='active'||manager.isRevoked(w))throw widgetError('widget_stopped');
    const id=randomUUID();if(!await host.request(w,'reserveEvent',{id}))throw widgetError('queue_full');
    try {const result=admit();if(!result.accepted)throw widgetError(result.reason);reservations.get(refKey(w))?.add(result.seq);await host.request(w,'commitEvent',{id,token:result.seq});return result;}
    catch(error){await host.request(w,'cancelEvent',{id}).catch(()=>{});throw error;}
  }
  async function paused(w,fn,{self=false}={}) {
    if(!self&&loaded.has(refKey(w)))await host.request(w,'pause',{});
    try{return await fn();}
    finally{const latest=store.get(w.widgetId);if(latest?.status==='active'&&!manager.isRevoked(latest)&&loaded.has(refKey(latest)))await host.request(latest,'activate',{});}
  }
  async function renderAll(w,{repair=false}={}) {
    const failures=[];
    for(const view of store.listViews(w.widgetId)) {
      try {
        const value=await host.request(w,'render',{view});authorize(w,view.target.chatId);
        await render.publish(w,value,{},view);
      } catch(error) {
        if(viewLossReason(error)){await manager.viewLost(w,view,viewLossReason(error));continue;}
        failures.push({viewId:view.id,code:error.code??'render_failed',message:String(error.message).slice(0,1000)});
        if(host.has(w))await host.request(w,'handleError',{error:{code:error.code??'render_failed',message:String(error.message),operation:'render',view:viewSnapshot(view)},viewId:view.id,quiet:true});
        else await manager.error(w,error,view.id);
      }
    }
    return failures;
  }
  const manager={store,host,
    withTarget:(botId,target,fn)=>locked('address:'+JSON.stringify([botId,target]),fn),
    isRevoked:r=>closed||r.generation<=(revoked.get(r.widgetId)??0)||!store.get(r.widgetId),
    originFor:r=>origins.get(refKey(r)),
    buttonsBlocked:viewId=>cutoffs.has(viewId),
    async create(scope,args,{callerRef}={}) {
      validateSetWidget(args);assertOpen();authorize(scope);
      const operation=locked(randomUUID(),async()=>{
        assertOpen();if(callerRef)authorize(callerRef);
        if(!host.canReserve(scope))throw widgetError('runtime_quota');
        let w;
        try {
          const built=await build(scope,args.handler);assertOpen();authorize(scope);if(callerRef)authorize(callerRef);
          w=store.create({...scope,handler:args.handler,snapshotId:built.snapshotId,description:args.description,state:args.state??{},lifecycleIntent:'initializing'});
          if(callerRef)origins.set(refKey(w),callerRef);
          await load(w);await initialize(w,{first:true});assertOpen();if(callerRef)authorize(callerRef);
          store.patch(w,{lifecycleIntent:null});await host.request(w,'activate',{});
          return {widgetId:w.widgetId};
        } catch(error) {
          if(w) {store.patch(w,{status:'stopped',stoppedReason:'init_failed',lifecycleIntent:null});store.clearPending(w);await retire(w);error.widgetId=w.widgetId;}
          await release(scope);throw error;
        } finally{if(w)origins.delete(refKey(w));}
      });return track(operation);
    },
    async update(scope,args,{callerRef}={}) {
      let w=own(scope,args.widgetId);validateSetWidget(args,w);assertOpen();
      return track(locked(w.widgetId,async()=>{
        w=own(scope,args.widgetId);const authority=w.status==='stopped'?scope:w;
        authorize(authority);if(callerRef&&callerRef.widgetId!==w.widgetId)authorize(callerRef);
        const built=args.handler?await build(authority,args.handler):{snapshotId:w.snapshotId};assertOpen();authorize(authority);
        const reinitialize=w.status==='stopped'||args.handler!==undefined||args.state!==undefined;
        return paused(w,async()=>{
          if(reinitialize) {
            await retire(w,{self:callerRef?.widgetId===w.widgetId});assertOpen();
            w=store.replace(w,{handler:args.handler??w.handler,snapshotId:built.snapshotId,description:args.description??w.description,status:'active',stoppedReason:null,lifecycleIntent:'initializing'},{keepPending:w.status==='active',keepEphemeral:true});
            if(args.state!==undefined)store.save(w,{state:args.state});
            if(callerRef&&callerRef.widgetId!==w.widgetId)origins.set(refKey(w),callerRef);
            try {await load(store.current(w));await initialize(w);assertOpen();store.patch(w,{lifecycleIntent:null});await restorePending(w);}
            catch(error) {store.patch(w,{status:'stopped',stoppedReason:'init_failed',lifecycleIntent:null});store.clearPending(w);await retire(w);await render.disable(w);await release(w);error.widgetId=w.widgetId;throw error;}
            finally{origins.delete(refKey(w));}
          } else if(args.description!==undefined)store.patch(w,{description:args.description});
          if(reinitialize){store.patch(w,{lastError:null});for(const view of store.listViews(w.widgetId))store.patchView(w,view.id,{lastError:null});}
          const failedViews=await renderAll(w,{repair:reinitialize});
          return {widgetId:w.widgetId,renderErrors:failedViews};
        },{self:callerRef?.widgetId===w.widgetId});
      },{self:callerRef?.widgetId===w.widgetId}));
    },
    async setView(scope,args,{callerRef}={}) {
      assertOpen();if(!args||typeof args!=='object'||Array.isArray(args))throw widgetError('invalid_argument');let w=own(scope,args.widgetId);
      if(!args||Object.keys(args).some(k=>!['widgetId','send','target','props'].includes(k))||Boolean(args.send)===Boolean(args.target))throw widgetError('invalid_argument','Use exactly one of send or target.');
      if(args.send!==undefined){
        const send=args.send;
        if(!send||typeof send!=='object'||Array.isArray(send)||send.chatId!==undefined&&(!Number.isSafeInteger(send.chatId)||send.chatId===0)||send.topicId!==undefined&&(!Number.isSafeInteger(send.topicId)||send.topicId<1))throw widgetError('invalid_argument');
        for(const key of ['disable_notification','protect_content'])if(send[key]!==undefined&&typeof send[key]!=='boolean')throw widgetError('invalid_argument');
        if(send.message_effect_id!==undefined&&typeof send.message_effect_id!=='string')throw widgetError('invalid_argument');
        if(send.reply_parameters!==undefined&&(!send.reply_parameters||typeof send.reply_parameters!=='object'||Array.isArray(send.reply_parameters)))throw widgetError('invalid_argument');
        plainJSON(send);
      }
      if(w.status!=='active')throw widgetError('widget_stopped');
      const props=JSON.parse(plainJSON(args.props??{}));if(!props||Array.isArray(props)||typeof props!=='object')throw widgetError('invalid_argument','View props must be a JSON object.');
      const target=args.target?widgetTarget(args.target.messageId!==undefined?{chatId:scope.chatId,...args.target}:args.target):{chatId:args.send.chatId??scope.chatId};
      const envelope=args.send??{};if(args.send&&Object.keys(envelope).some(k=>!['chatId','topicId','reply_parameters','disable_notification','protect_content','message_effect_id'].includes(k)))throw widgetError('invalid_argument');
      if(target.inlineMessageId)assertInlineOwner(scope,target.inlineMessageId);else authorize(w,target.chatId);
      const atEntry=args.target&&store.byTarget(w.botId,target);
      if(atEntry&&atEntry.widgetId!==w.widgetId)throw Object.assign(widgetError('view_conflict','This message belongs to another widget.'),{ownerAgentId:atEntry.agentId,widgetId:atEntry.widgetId,viewId:atEntry.id});
      cutoff(atEntry?.id,1);
      const address=args.target?JSON.stringify([w.botId,target]):randomUUID();
      return track(locked('address:'+address,()=>locked(w.widgetId,async()=>{
        w=own(scope,w.widgetId);if(w.status!=='active')throw widgetError('widget_stopped');
        const old=args.target&&store.byTarget(w.botId,target);
        if(old&&old.widgetId!==w.widgetId)throw Object.assign(widgetError('view_conflict','This message belongs to another widget.'),{ownerAgentId:old.agentId,widgetId:old.widgetId,viewId:old.id});
        let message=old?.message??null;
        if(args.target&&!old&&!target.inlineMessageId) {
          message=db.getMessage(w.botId,target.chatId,target.messageId);
          if(!message||message.via_bot||(message.from?.id!==db.getBot(w.botId).telegramId&&message.sender_chat?.id!==target.chatId))throw widgetError('message_not_found','Attach requires a known bot message without via_bot.');
        }
        const candidate={id:'v'+randomUUID().replaceAll('-',''),target,props,chatId:target.chatId,messageId:target.messageId,message,topicId:envelope.topicId??old?.topicId??message?.message_thread_id??null,chatType:target.chatId?db.getChat(w.botId,target.chatId)?.chatType:null,renderSpec:old?.renderSpec??null,renderHash:null,buttonNames:[],pollId:null};
        return paused(w,async()=>{
          let publication;
          try {
            const value=await host.request(w,'render',{view:candidate});
            const {chatId,topicId,...creation}=envelope;
            const result=publication=await render.publish(w,value,creation,candidate);assertOpen();
            if(manager.isRevoked(w)||store.get(w.widgetId)?.status!=='active')throw widgetError('widget_stopped');
            authorize(w,target.chatId);
            const fields={...candidate,...result.projection,target:result.target,lastError:null};
            let view;
            try{view=old?store.replaceView(w,old.id,fields):store.createView(w,fields);}
            catch(cause){throw Object.assign(widgetError('storage_failed','Telegram confirmed publication but binding persistence failed; do not resend.'),{confirmedMessageId:result.target.messageId,confirmedTarget:result.target,cause});}
            render.confirm?.(w,candidate.id);
            store.patch(w,{lastError:null});return {viewId:view.id,target:view.target};
          } catch(error) {
            error.widgetId=w.widgetId;error.viewId=candidate.id;
            if(publication){error.confirmedTarget=publication.target;error.confirmedMessageId=publication.target.messageId;}
            const uncertain=error.confirmedTarget||['delivery_unknown','storage_failed'].includes(error.code);
            try{
              if(old&&uncertain)store.patchView(w,old.id,{deliveryUnknown:true});
              if(!args.target&&uncertain)store.addCandidate(w,{viewId:candidate.id,target:error.confirmedTarget??(error.nativeMessage?.message_id?{chatId:target.chatId,messageId:error.nativeMessage.message_id}:target),reason:error.code});
            }catch{} // The pre-effect receipt remains if the database is unavailable.
            if(publication&&manager.isRevoked(w))await render.disable(w,{...candidate,...publication.projection,target:publication.target,chatId:publication.target.chatId,messageId:publication.target.messageId});
            if(host.has(w)&&!manager.isRevoked(w))await host.request(w,'handleError',{error:{code:error.code??'render_failed',message:String(error.message),operation:old?'replace':'attach',view:viewSnapshot(candidate),...(old?{previousView:viewSnapshot(old)}:{})},...(old?{viewId:old.id}:{}),quiet:true}).catch(()=>{});
            throw error;
          }
        },{self:callerRef?.widgetId===w.widgetId});
      },{self:callerRef?.widgetId===w.widgetId})).finally(()=>cutoff(atEntry?.id,-1)));
    },
    async deleteView(scope,{viewId},{self=false}={}) {
      assertOpen();const view=store.getView(viewId),candidate=store.getCandidate(viewId),w=own(scope,view?.widgetId??candidate?.widgetId);
      if(!view){store.removeCandidate(w,viewId);render.confirm?.(w,viewId);return;}
      cutoff(viewId,1);
      return track(locked(w.widgetId,()=>paused(w,async()=>{await render.disable(w,view);store.detachView(w,viewId);render.forget(viewId);},{self}),{self}).finally(()=>cutoff(viewId,-1)));
    },
    async delete(scope,{widgetId},{self=false,administrative=false}={}) {
      const w=own(scope,widgetId);assertOpen();revoke(w);store.deletionIntent(w);
      const work=locked(widgetId,async()=>{await retire(w);await render.disable(w);for(const view of store.listViews(widgetId))render.forget(view.id);removeReceipts(w);store.remove(widgetId);hooks.delete(widgetId);revoked.delete(widgetId);await release(w);if(administrative)await notify(w,{eventType:'widget_deleted',widgetId});},{self});
      track(work);if(!self)return work;
    },
    async list(scope) {const items=store.list(scope);return {canCreate:host.canReserve(scope)?Math.max(0,L.widgets-items.length):0,items:items.map(w=>({...publicWidget(w),viewCount:store.listViews(w.widgetId).length,hasError:Boolean(w.lastError||store.listViews(w.widgetId).some(v=>v.lastError)||store.listCandidates(w.widgetId).length)}))};},
    get(scope,{widgetId}) {const w=own(scope,widgetId);return {...w,views:store.listViews(widgetId),possiblePublications:store.listCandidates(widgetId)};},
    async describe(w){return {...store.get(w.widgetId),views:store.listViews(w.widgetId),possiblePublications:store.listCandidates(w.widgetId)};},
    state(scope,{widgetId}) {return structuredClone(own(scope,widgetId).state);},
    async event(scope,{widgetId,name,data=null},{source='agent',fromWidgetId}={}) {
      assertActionName(name);assertOpen();const w=own(scope,widgetId);authorize(w);
      return manager.admit(w,{name,source,data,receivedAt:new Date().toISOString(),delayed:false,...(fromWidgetId?{fromWidgetId}:{})});
    },
    async admit(w,event,admission) {
      assertOpen();if(event.source==='button'&&admission&&cutoffs.has(admission.viewId))throw widgetError('widget_stopped');
      const latest=own(w,w.widgetId),admit=()=>store.admit(latest,event,{durable:event.source!=='button',admission});
      if(!loaded.has(refKey(latest)))return admit();
      return track(schedule(latest,admit));
    },
    async begin(ref,seq) {
      const row=db.sql.prepare('SELECT payload,admission FROM widget_events WHERE widgetId=? AND seq=? AND started=0').get(ref.widgetId,seq);
      if(!row)throw widgetError('widget_stopped');
      const event=JSON.parse(row.payload),meta=row.admission&&JSON.parse(row.admission),w=store.current(ref);
      let valid=w.status==='active';
      if(meta) {
        const view=store.byTarget(w.botId,meta.target);
        valid=valid&&view?.widgetId===w.widgetId&&view.bindingEpoch===meta.bindingEpoch;
        if(event.source==='button')valid=valid&&view.id===meta.viewId&&!view.deliveryUnknown&&view.buttonNames.includes(meta.callbackData);
        if(event.source==='poll'||event.source==='poll_answer')valid=valid&&view.pollId===meta.pollId;
      }
      if(!valid){store.drop(ref,seq);if(event.source==='button')await ackCallback(event.data.id,ref).catch(()=>{});return {name:'__ignore',source:'local',data:null,receivedAt:new Date().toISOString(),delayed:false};}
      return store.begin(ref,seq);
    },
    complete(ref,seq) {reservations.get(refKey(ref))?.delete(seq);store.complete(ref,seq);},
    async publish(ref,viewId,value) {
      const view=store.getView(viewId);if(!view||view.widgetId!==ref.widgetId)throw widgetError('view_not_found');
      try{return await render.publish(ref,value,{},view);}
      catch(error){const reason=viewLossReason(error);if(!reason)throw error;await manager.viewLost(ref,view,reason);return {deleted:true};}
    },
    async viewLost(ref,view,reason) {
      if(!store.getView(view.id))return;
      const w=store.current(ref);store.detachView(w,view.id);render.forget(view.id);
      if(w.status==='active'&&manager.hasHook(w,'onViewDelete'))await schedule(w,()=>store.admit(w,{name:'onViewDelete',source:'view_delete',view:viewSnapshot(view),reason,data:{view:viewSnapshot(view),reason},receivedAt:new Date().toISOString(),delayed:false}));
    },
    hasHook(w,name) {return hooks.get(w.widgetId)?.includes(name)??false;},
    async error(ref,error,viewId,{quiet=false}={}) {
      const w=store.get(ref.widgetId);if(!w||w.generation!==ref.generation||w.lifecycleIntent==='delete')return;
      const view=viewId&&store.getView(viewId),lastError={...error,code:error.code??'widget_failed',message:String(error.message).slice(0,1000),at:new Date().toISOString()},previous=view?view.lastError:w.lastError;
      if(view)store.patchView(w,view.id,{lastError,...(['delivery_unknown','storage_failed'].includes(error.code)?{deliveryUnknown:true}:{})});else store.patch(w,{lastError});
      if(!previous&&!quiet)await notify(w,{eventType:'widget_error',widgetId:w.widgetId,...(view?{viewId:view.id}:{}),error:lastError.code,description:lastError.message});
    },
    async failure(owner,error) {
      const affected=store.list(owner).filter(w=>w.status==='active');for(const w of affected)revoke(w);const acknowledgements=affected.map(ackQueued);store.disableOwner(owner,error.code??'runtime_failed');await host.release(owner);await Promise.allSettled([...acknowledgements,...affected.map(w=>render.disable(w))]);
      if(affected.length)await notify(owner,{eventType:'widget_runtime_failed',widgets:affected.map(publicWidget),error:error.code??'runtime_failed',description:String(error.message).slice(0,1000)});
    },
    async disableOwner(owner,reason='agent_disabled') {const all=store.list(owner);for(const w of all)revoke(w);const acknowledgements=all.map(ackQueued);store.disableOwner(owner,reason);await Promise.allSettled(all.map(retire));await host.release(owner);await Promise.allSettled([...acknowledgements,...all.map(w=>render.disable(w))]);},
    async removeOwner(owner) {for(const w of store.list(owner))await manager.delete(owner,{widgetId:w.widgetId});},
    async removeChat(botId,chatId) {for(const w of store.list({botId}))for(const view of store.listViews(w.widgetId))if(view.target.chatId===chatId)await manager.deleteView(w,{viewId:view.id});},
    async recover() {
      const interrupted=store.recovery();for(const id of interrupted){const w=store.get(id);if(w)await manager.error(w,{code:'interrupted_effect',message:'In-flight work was interrupted and will not be replayed.'});}
      for(const row of db.sql.prepare('SELECT widgetId FROM widgets').all()) {
        const w=store.get(row.widgetId);if(!w||manager.isRevoked(w))continue;
        if(recoverReceipts(w,store))await manager.error(w,{code:'interrupted_publication',message:'Publication confirmation was not committed; inspect the view or publication candidate before repairing.'});
        if(w.lifecycleIntent){store.patch(w,{status:'stopped',stoppedReason:'interrupted_initialization',lifecycleIntent:null});store.clearPending(w);continue;}
        if(w.status!=='active')continue;
        try {authorize(w);await load(w);await initialize(w,{quiet:false});await restorePending(w);await host.request(w,'activate',{});}
        catch(error){if(['sandbox_unavailable','widget_stopped'].includes(error.code)){await manager.failure(w,error);continue;}store.patch(w,{status:'stopped',stoppedReason:'init_failed'});store.clearPending(w);await retire(w);await manager.error(w,error);}
      }
    },
    async idle(){while(jobs.size)await Promise.allSettled([...jobs]);},
    async close(){closed=true;await Promise.allSettled(db.sql.prepare("SELECT * FROM widgets WHERE status='active'").all().map(w=>retire(store.get(w.widgetId))));await host.close();await manager.idle();},
    // Transitional internal adapter; the public agent tools are replaced separately.
    async set(scope,args,options={}) {if(args.widgetId)return manager.update(scope,args,options);const {chatId,messageId,topicId,reply_parameters,disable_notification,protect_content,message_effect_id,...creation}=args;const w=await manager.create(scope,creation,options);await manager.setView(scope,{widgetId:w.widgetId,...(messageId?{target:{chatId:chatId??scope.chatId,messageId}}:{send:{...(chatId!==undefined?{chatId}:{}),...(topicId!==undefined?{topicId}:{}),...(reply_parameters!==undefined?{reply_parameters}:{}),...(disable_notification!==undefined?{disable_notification}:{}),...(protect_content!==undefined?{protect_content}:{}),...(message_effect_id!==undefined?{message_effect_id}:{})}})},options);return w;},
    render(scope,args){return manager.update(scope,args);},
  };
  return manager;
}
