import { randomUUID } from "node:crypto";
import { plainJSON, validateReactMount, WIDGET_LIMITS, widgetError } from "./contract.mjs";

const id=()=>"v"+randomUUID().replaceAll("-","");
const publicWidget=w=>({widgetId:w.widgetId,description:w.description,status:w.status,
  storeVersion:w.storeVersion,storeRevision:w.storeRevision,handler:w.handler});

/** Controller lifecycle for React widgets. No legacy queue or named action replay. */
export function createReactWidgetManager({db,host,store,build,authorize,notify=async()=>{},
  snapshotPath,disableView=async()=>{},assertInlineOwner=()=>{},receipts,invalidateParent=()=>{},invalidateView=()=>{},agentRequests,clock=Date.now}) {
  const locks=new Map(),callbackJobs=new Set(),subscriptions=new Map(),errorReports=new Map();
  let closed=false;
  const own=(scope,widgetId)=>{
    const w=store.get(widgetId);
    if(!w||w.botId!==scope.botId||w.agentId!==scope.agentId||w.lifecycleIntent==="delete")
      throw widgetError("widget_not_found");
    return w;
  };
  const ownerOf=w=>({botId:w.botId,agentId:w.agentId});
  function locked(key,fn){
    const previous=locks.get(key)??Promise.resolve();
    const next=previous.catch(()=>{}).then(fn);
    locks.set(key,next);
    next.finally(()=>{if(locks.get(key)===next)locks.delete(key);}).catch(()=>{});
    return next;
  }
  async function load(w,{fresh=false}={}){
    await host.reserve(w);
    return host.load(w,{snapshotPath:snapshotPath(w.buildId,w),buildId:w.buildId,
      runtimeProps:w.runtimeProps,saved:fresh?undefined:{version:w.storeVersion,
        revision:w.storeRevision,state:w.state}});
  }
  async function restoreViews(w){
    const errors=[];
    for(const view of store.listViews(w.widgetId)){
      if(view.targetKind==="ephemeral")continue;
      try{await host.request(w,"mount",{viewId:view.id,target:view.target,
        component:view.exportName,props:view.props,bindingEpoch:view.bindingEpoch,message:view.message});}
      catch(error){errors.push({viewId:view.id,code:error.code??"render_failed",message:String(error.message)});}
    }
    return errors;
  }
  const manager={react:true,store,host,
    withTarget:(botId,target,fn)=>locked("target:"+JSON.stringify([botId,target]),fn),
    isRevoked:ref=>closed||!store.get(ref.widgetId)||store.get(ref.widgetId).generation!==ref.generation,
    originFor:()=>null,
    buttonsBlocked:()=>false,
    setSubscription(ref,viewId,type,active){
      store.current(ref);
      const view=store.getView(viewId);
      if((view&&view.widgetId!==ref.widgetId)||!["reply","reaction"].includes(type))
        throw widgetError("view_not_found");
      const key=viewId+":"+type;
      if(active)subscriptions.set(key,{widgetId:ref.widgetId,generation:ref.generation,
        bindingEpoch:view?.bindingEpoch??null});
      else subscriptions.delete(key);
    },
    hasSubscription(view,type){
      const entry=subscriptions.get(view.id+":"+type);
      return entry?.widgetId===view.widgetId&&entry.generation===store.get(view.widgetId)?.generation&&
        (entry.bindingEpoch===null||entry.bindingEpoch===view.bindingEpoch);
    },
    touchEphemeral(view,userId,now=Date.now()){
      if(view.targetKind!=="ephemeral"||view.receiverUserId!==userId)return false;
      const w=store.get(view.widgetId);
      if(!w||w.status!=="active")return false;
      store.patchView(w,view.id,{activeAt:now});
      return true;
    },
    async dispatchViewEvent(widget,view,type,event){
      if(!manager.hasSubscription(view,type))return false;
      const job=Promise.resolve().then(()=>host.request(widget,"event",{
        viewId:view.id,type,event,
      })).catch(async error=>{
        if(error.code!=="view_not_found"&&error.code!=="widget_stopped")
          await manager.error(widget,error,view.id).catch(()=>{});
      }).finally(()=>callbackJobs.delete(job));
      callbackJobs.add(job);
      return true;
    },
    async dispatchCallback(widget,view,callback,ack){
      const current=store.getView(view.id);
      if(!current||current.bindingEpoch!==view.bindingEpoch||
          store.get(widget.widgetId)?.generation!==widget.generation){
        await ack();return;
      }
      const job=Promise.resolve().then(()=>host.request(widget,"callback",{
        viewId:view.id,token:callback.data,
        event:{callbackQueryId:callback.id,from:callback.from,data:callback.data,
          ...(callback.message?{message:callback.message}:{}),
          ...(callback.inline_message_id?{inlineMessageId:callback.inline_message_id}:{})},
      })).catch(async error=>{
        if(error.code!=="button_expired"&&error.code!=="widget_stopped")
          await manager.error(widget,error,view.id).catch(()=>{});
      }).finally(async()=>{await ack();callbackJobs.delete(job);});
      callbackJobs.add(job);
    },
    async create(scope,args){
      if(closed)throw widgetError("widget_stopped");
      if(typeof args?.handler!=="string"||typeof args.description!=="string"||!args.description.trim())
        throw widgetError("invalid_argument","Handler and description are required.");
      plainJSON(args.props??{});
      authorize(scope);
      if(!host.canReserve(scope))throw widgetError("runtime_quota");
      const built=await build(scope,args.handler);
      authorize(scope);
      let w;
      try{
        w=store.create({...scope,handler:args.handler,buildId:built.snapshotId,
          description:args.description,runtimeProps:args.props??{},state:{}});
        await load(w,{fresh:true});
        return {widgetId:w.widgetId};
      }catch(error){
        if(w)store.remove(w.widgetId);
        if(!store.list(scope).some(item=>item.status==="active"))await host.release(scope);
        throw error;
      }
    },
    async update(scope,args){
      let w=own(scope,args.widgetId);
      return locked(w.widgetId,async()=>{
        w=own(scope,args.widgetId);authorize(w);
        const built=args.handler?await build(w,args.handler):{snapshotId:w.buildId};
        const changed=args.handler!==undefined||args.props!==undefined||w.status==="error";
        if(!changed){if(args.description!==undefined)store.patch(w,{description:args.description});
          return {widgetId:w.widgetId,renderErrors:[]};}
        agentRequests?.cancelWidget(w);
        if(host.has(w))await host.request(w,"retire",{}).catch(()=>{});
        for(const view of store.listViews(w.widgetId)){
          if(view.targetKind!=="ephemeral"){
            invalidateParent(view.id);
            continue;
          }
          invalidateView(view.id);
          subscriptions.delete(view.id+":reply");subscriptions.delete(view.id+":reaction");
          await disableView(w,view).catch(()=>{});
        }
        w=store.replace(w,{handler:args.handler??w.handler,buildId:built.snapshotId,
          description:args.description??w.description,
          runtimeProps:args.props??w.runtimeProps,status:"active",lastError:null});
        await load(w);
        return {widgetId:w.widgetId,renderErrors:await restoreViews(w)};
      });
    },
    async setView(scope,args){
      if(closed)throw widgetError("widget_stopped");
      const w=own(scope,args.widgetId);
      if(w.status!=="active")throw widgetError("widget_stopped");
      if(Boolean(args.viewId)+Boolean(args.send)+Boolean(args.target)!==1)
        throw widgetError("invalid_argument","Use one viewId, send, or target selector.");
      let existing=args.viewId?store.getView(args.viewId):null;
      if(existing&&existing.widgetId!==w.widgetId)throw widgetError("view_conflict");
      const target=existing?.target??(args.target
        ? {...(args.target.messageId!==undefined&&!args.target.chatId?{chatId:scope.chatId}:{}),...args.target}
        :args.send?.guestRequestId?{guestRequestId:args.send.guestRequestId}
          :{chatId:args.send?.chatId??scope.chatId,...(args.send?.topicId?{topicId:args.send.topicId}:{}),
            ...(args.send?.reply_parameters?{reply_parameters:args.send.reply_parameters}:{})});
      const component=args.component??existing?.exportName;
      const props=args.props??existing?.props??{};
      validateReactMount({target,component,props,origin:"agent"});
      if(target.inlineMessageId)assertInlineOwner(scope,target.inlineMessageId);
      else if(target.guestRequestId)authorize(w);
      else authorize(w,target.chatId);
      const conflict=(target.inlineMessageId||target.messageId||target.ephemeralMessageId)
        ?store.byTarget(w.botId,target):null;
      if(conflict&&conflict.widgetId!==w.widgetId)
        throw Object.assign(widgetError("view_conflict"),{ownerAgentId:conflict.agentId,widgetId:conflict.widgetId,viewId:conflict.id});
      if(conflict)existing=conflict;
      const viewId=existing?.id??id();
      const result=await host.request(w,"mount",{viewId,target,component,props,
        options:{force:Boolean(args.force)},bindingEpoch:existing?.bindingEpoch,message:existing?.message});
      if(result.status==="error")return {viewId,status:"error",error:result.error,
        ...(result.target?{target:result.target}:{})};
      return {viewId,target:result.target};
    },
    async updateStore(scope,{widgetId,state}){
      own(scope,widgetId);
      return locked(widgetId,async()=>{
        const current=own(scope,widgetId);
        if(current.status!=="active")throw widgetError("widget_stopped");
        plainJSON(state);
        return host.request(current,"replaceStore",{state});
      });
    },
    async dispatchAction(scope,{widgetId,action,args={}}){
      own(scope,widgetId);
      return locked(widgetId,async()=>{
        const current=own(scope,widgetId);
        if(current.status!=="active")throw widgetError("widget_stopped");
        if(typeof action!=="string"||!/^[a-z][A-Za-z0-9_]*$/.test(action)||
          !args||typeof args!=="object"||Array.isArray(args))
          throw widgetError("invalid_argument");
        plainJSON(args);
        return host.request(current,"dispatchAction",{action,args});
      });
    },
    async deleteView(scope,{viewId}){
        const view=store.getView(viewId),candidate=store.getCandidate(viewId);
        const w=own(scope,view?.widgetId??candidate?.widgetId);
        invalidateView(viewId);
        if(!view){store.removeCandidate(w,viewId);receipts?.done(w,viewId);return;}
      invalidateParent(viewId);
      if(view.targetKind!=="ephemeral")await this.closeOverlays(w,viewId);
      await disableView(w,view).catch(()=>{});
      if(host.has(w))await host.request(w,"unmount",{viewId}).catch(()=>{});
      subscriptions.delete(viewId+":reply");subscriptions.delete(viewId+":reaction");
      store.detachView(w,viewId);
    },
    async detachExternal(scope,viewId){
        const view=store.getView(viewId);
        if(!view)return;
        const w=own(scope,view.widgetId);
        invalidateView(viewId);
        invalidateParent(viewId);
      if(view.targetKind!=="ephemeral")await this.closeOverlays(w,viewId);
      subscriptions.delete(viewId+":reply");subscriptions.delete(viewId+":reaction");
      store.detachView(w,viewId);
      receipts?.done(w,viewId);
      if(host.has(w))await host.request(w,"unmount",{viewId}).catch(()=>{});
    },
    async detachRuntimeView(ref,viewId){
        const w=store.current(ref),view=store.getView(viewId);
        if(!view||view.widgetId!==w.widgetId)throw widgetError("view_not_found");
        invalidateView(viewId);
        invalidateParent(viewId);
      if(view.targetKind!=="ephemeral")await this.closeOverlays(w,viewId);
      await disableView(w,view);
      subscriptions.delete(viewId+":reply");subscriptions.delete(viewId+":reaction");
      store.detachView(w,viewId);
    },
    async closeOverlays(ref,parentViewId){
      const w=store.current(ref),parent=store.getView(parentViewId);
      if(!parent||parent.widgetId!==w.widgetId)throw widgetError("view_not_found");
      invalidateParent(parentViewId);
        const ids=[];
        for(const child of store.listViews(w.widgetId).filter(view=>view.parentViewId===parentViewId)){
          invalidateView(child.id);
          await disableView(w,child).catch(()=>{});
        subscriptions.delete(child.id+":reply");subscriptions.delete(child.id+":reaction");
        store.detachView(w,child.id);ids.push(child.id);
      }
      return ids;
    },
    async expireEphemeralViews(now=Date.now()){
      const expired=db.sql.prepare("SELECT viewId,widgetId FROM widget_views WHERE targetKind='ephemeral' AND activeAt<=? ORDER BY activeAt,viewId")
        .all(now-20*60*1000);
      for(const item of expired){
        const w=store.get(item.widgetId);
        if(w&&store.getView(item.viewId))await this.deleteView(w,{viewId:item.viewId});
      }
      return expired.length;
    },
    async delete(scope,{widgetId}){
      const w=own(scope,widgetId);
      return locked(widgetId,async()=>{
        agentRequests?.cancelWidget(w);
        store.deletionIntent(w);
        if(host.has(w))await host.request(w,"retire",{}).catch(()=>{});
        for(const view of store.listViews(widgetId)){
          subscriptions.delete(view.id+":reply");subscriptions.delete(view.id+":reaction");
        }
        await Promise.allSettled(store.listViews(widgetId).map(view=>disableView(w,view)));
        receipts?.remove?.(w);
        store.remove(widgetId);
        if(!store.list(ownerOf(w)).some(item=>item.status==="active"))await host.release(w);
      });
    },
    async list(scope){const items=store.list(scope),usedBytes=await host.memoryUsage?.(scope)??null;
      return {memory:{usedBytes,limitBytes:WIDGET_LIMITS.memory},
      items:items.map(w=>({...publicWidget(w),viewCount:store.listViews(w.widgetId).length,
        hasError:Boolean(w.lastError||store.listCandidates(w.widgetId).length)}))};},
    get(scope,{widgetId}){const w=own(scope,widgetId);return {...w,views:store.listViews(widgetId),
      possiblePublications:store.listCandidates(widgetId)};},
    async error(ref,error,viewId){
      const w=store.get(ref.widgetId);if(!w||w.generation!==ref.generation)return;
      const detail={code:error.code??"widget_failed",message:String(error.message).slice(0,1000),at:new Date(clock()).toISOString()};
      if(viewId&&store.getView(viewId))store.patchView(w,viewId,{status:"error",lastError:detail});
      else {agentRequests?.cancelWidget(w);store.patch(w,{status:"error",lastError:detail});}
      const key=JSON.stringify([w.widgetId,viewId??null,detail.code,detail.message]),time=clock();
      const report=errorReports.get(key);
      if(report&&time-report.lastAt<5*60*1000){report.suppressed++;return;}
      const repeats=report?.suppressed??0;
      errorReports.set(key,{lastAt:time,suppressed:0});
      if(errorReports.size>1000)errorReports.delete(errorReports.keys().next().value);
      await notify(w,{eventType:"widget_error",widgetId:w.widgetId,viewId,error:detail.code,
        description:repeats?`${detail.message} (repeated ${repeats} time${repeats===1?"":"s"} since the last report)`:detail.message});
    },
    async failure(owner,error){agentRequests?.cancelOwner(owner);store.disableOwner(owner,error);
      const diagnostic=error.diagnosticPath?` Diagnostic dump: ${error.diagnosticPath}`:
        error.diagnosticUnavailable?" Diagnostic dump unavailable.":"";
      await notify(owner,{eventType:"widget_runtime_failed",error:error.code??"runtime_failed",
        description:String(error.message)+diagnostic});},
    async disableOwner(owner,reason="agent_disabled"){
      agentRequests?.cancelOwner(owner);
      for(const w of store.list(owner)){
        if(host.has(w))await host.request(w,"retire",{}).catch(()=>{});
        for(const view of store.listViews(w.widgetId)){
          subscriptions.delete(view.id+":reply");subscriptions.delete(view.id+":reaction");
        }
        await Promise.allSettled(store.listViews(w.widgetId).map(view=>disableView(w,view)));
      }
      store.disableOwner(owner,reason);await host.release(owner);
    },
    async removeOwner(owner){for(const w of store.list(owner))await this.delete(owner,{widgetId:w.widgetId});},
    async removeChat(botId,chatId){for(const w of store.list({botId}))
      for(const view of store.listViews(w.widgetId))if(view.target.chatId===chatId)
        await this.deleteView(w,{viewId:view.id});},
    async recover(){
      agentRequests?.close();
      for(const row of db.sql.prepare("SELECT viewId,widgetId FROM widget_views WHERE targetKind='ephemeral'").all()){
        const w=store.get(row.widgetId),view=store.getView(row.viewId);
        if(w&&view)await disableView(w,view).catch(()=>{});
      }
      store.recovery();
      for(const {widgetId} of db.sql.prepare("SELECT widgetId FROM widgets WHERE status='active'").all()){
        const w=store.get(widgetId);
        try{authorize(w);await load(w);await restoreViews(w);}
        catch(error){await this.error(w,error);}
      }
    },
    async idle(){while(locks.size||callbackJobs.size)
      await Promise.allSettled([...locks.values(),...callbackJobs]);},
    async close(){closed=true;for(const w of db.sql.prepare("SELECT widgetId FROM widgets WHERE status='active'").all()){
      const full=store.get(w.widgetId);if(host.has(full))await host.request(full,"retire",{}).catch(()=>{});
    }await host.close();},
  };
  return manager;
}
