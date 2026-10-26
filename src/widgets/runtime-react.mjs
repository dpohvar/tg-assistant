import { pathToFileURL } from "node:url";
import {randomUUID} from "node:crypto";
import { createReactRuntime } from "./reconciler.mjs";
import { projectHostTree } from "./projection.mjs";
import { connectWidgetTransport } from "./transport.mjs";
import { WIDGET_API_METHODS } from "./api.mjs";
import { WIDGET_LIMITS as L, validateAgentRequestPayload, widgetError } from "./contract.mjs";

/** Runs inside the agent sandbox; closures and React nodes never cross RPC. */
export function createReactWidgetProcess({request}) {
  const refs=new Map(),callbacks=new Map();
  let runtime;
  const bridge={
    storeRevision(widgetId,revision) {
      const ref=refs.get(widgetId);
      return request("save",{ref,...revision});
    },
    subscription(widgetId,viewId,type,active){
      const ref=refs.get(widgetId);
      if(ref)void request("subscription",{ref,viewId,type,active}).catch(()=>{});
    },
    unmount(widgetId,viewId){
      const ref=refs.get(widgetId);
      return request("detach",{ref,viewId});
    },
    closeOverlays(widgetId,parentViewId){
      const ref=refs.get(widgetId);
      return request("closeOverlays",{ref,parentViewId});
    },
    notifyAgent(widgetId,payload){
      const ref=refs.get(widgetId);
      return request("api",{ref,name:"notify_agent",args:payload});
    },
    async requestAgent(widgetId,payload,{timeoutMs,signal}={}){
      const ref=refs.get(widgetId);
      const snapshot=validateAgentRequestPayload(payload);
      if(signal?.aborted)throw widgetError("request_cancelled");
      if(timeoutMs===undefined&&!signal)throw widgetError("invalid_argument","Provide timeoutMs or signal.");
      const {requestId}=await request("beginAgentRequest",{ref,payload:snapshot,timeoutMs,
        hasSignal:Boolean(signal)});
      const cancel=()=>void request("cancelAgentRequest",{ref,requestId}).catch(()=>{});
      if(signal){signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();}
      try{return await request("waitAgentRequest",{ref,requestId});}
      finally{signal?.removeEventListener("abort",cancel);}
    },
    async commit(widgetId,roots,storeRevision,views) {
      const ref=refs.get(widgetId);
      const rootsById=new Map();
      function collect(node) {
        if(node.type==="widget-view")rootsById.set(node.props.viewId,node);
        else for(const child of node.children??[])collect(child);
      }
      for(const root of roots)collect(root);
      for(const [viewId,view] of views){
        const tree=rootsById.get(viewId);
        if(!tree||view.status!=="active")continue;
        try {
          const {body,replyMarkup,callbacks:nextCallbacks}=projectHostTree(tree,{
            priorBody:view.projection?.body,
            creating:!view.message&&!view.target?.messageId&&!view.target?.inlineMessageId&&
              !view.target?.ephemeralMessageId,
          });
          const exported=typeof view.component==="string"?view.component:
            Object.entries(runtime.module(widgetId).exports).find(([,value])=>value===view.component)?.[0];
          const ephemeral=Boolean(view.target?.receiverUserId);
          const outcome=await request("publish",{ref,viewId,target:view.target,
            component:exported??null,parentViewId:view.parentViewId,
            props:ephemeral?{}:view.props,body,replyMarkup,storeRevision,
            bindingEpoch:view.bindingEpoch});
          for(const childId of outcome.closedOverlayIds??[]){
            const child=views.get(childId);
            if(child){child.status="disabled";callbacks.delete(childId);
              setTimeout(()=>void runtime.unmount(widgetId,childId,{controller:true}).catch(()=>{}),0);}
          }
          if(["confirmed","unchanged"].includes(outcome.status)){
            view.target=outcome.target??outcome.view?.target??view.target;
            view.message=outcome.view?.message??view.message;
            view.projection={body,replyMarkup};
            view.status="active";view.error=null;
            callbacks.set(viewId,{widgetId,handlers:nextCallbacks});
            if(outcome.status==="confirmed")runtime.deliverMessage(widgetId,viewId,
              view.message??(view.target?.inlineMessageId?
                {inline_message_id:view.target.inlineMessageId}:null));
          } else if(outcome.status==="view_error"){
            view.status="error";view.error=outcome.error;
          } else if(outcome.status==="removed"){
            callbacks.delete(viewId);
            view.status="error";view.error=outcome.error;
          } else if(outcome.status==="unknown"){
            view.status="error";view.error=outcome.error??{code:"delivery_unknown",message:outcome.reason};
          }
        } catch(error) {
          view.status="error";view.error={code:error.code??"render_failed",message:String(error.message)};
          await request("notifyError",{ref,viewId,error:view.error}).catch(()=>{});
        }
      }
    },
    runtimeError(widgetId,error) {
      const ref=refs.get(widgetId);
      if(ref)void request("notifyError",{ref,error:{code:error.code??"runtime_failed",message:String(error.message)}}).catch(()=>{});
    },
    viewError(widgetId,viewId,error) {
      const ref=refs.get(widgetId);
      if(ref)void request("notifyError",{ref,viewId,error}).catch(()=>{});
    },
    telegramFor(widgetId){return Object.freeze(Object.fromEntries([...WIDGET_API_METHODS]
      .map(name=>[name,args=>request("api",{ref:refs.get(widgetId),name,args})])));},
  };
  runtime=createReactRuntime({bridge});
  async function overlay(ref,viewId,event,node,options){
    const source=runtime.view(ref.widgetId,viewId);
    if(!source)throw widgetError("view_not_found");
    if(source.user){
      if(!source.parent)throw widgetError("invalid_argument","Standalone private views cannot be overlaid.");
      return source.mount(node,options);
    }
    const chatId=source.target?.chatId,userId=event.from?.id;
    if(!Number.isSafeInteger(chatId)||!Number.isSafeInteger(userId)||userId<1||
        !event.callbackQueryId)
      throw widgetError("invalid_argument","Overlay needs a public chat view and a fresh callback.");
    const existing=runtime.findOverlay(ref.widgetId,viewId,userId);
    // Revert is a client-side action: Telegram sends no update when the user restores
    // the public message. Editing the old ephemeral ID succeeds but stays invisible.
    // A public launcher click must therefore allocate a fresh private message.
    if(existing)await runtime.unmount(ref.widgetId,existing.id);
    return runtime.mount({widgetId:ref.widgetId,
      viewId:"v"+randomUUID().replaceAll("-",""),
      target:{chatId,receiverUserId:userId,callbackQueryId:event.callbackQueryId,
        replaceCallbackQueryMessage:true},
      parentViewId:viewId,user:event.from,node,origin:"runtime",options});
  }
  return {
    async load(ref,{snapshotPath,buildId,runtimeProps={},saved}) {
      refs.set(ref.widgetId,ref);
      try {await runtime.create({widgetId:ref.widgetId,buildId,generation:ref.generation,
        factory:()=>import(pathToFileURL(snapshotPath).href),props:runtimeProps,saved});}
      catch(error){refs.delete(ref.widgetId);throw error;}
      await request("save",{ref,...runtime.state(ref.widgetId)});
      return {widgetId:ref.widgetId};
    },
    async mount(ref,args){
      const view=await runtime.mount({widgetId:ref.widgetId,...args});
      return {viewId:view.id,status:view.status,error:view.error,target:view.target};
    },
    async unmount(ref,{viewId,controller=true}){
      if(callbacks.get(viewId)?.widgetId===ref.widgetId)callbacks.delete(viewId);
      await runtime.unmount(ref.widgetId,viewId,{controller});
    },
    async callback(ref,{viewId,token,event}){
      const entry=callbacks.get(viewId);
      const handler=entry?.widgetId===ref.widgetId?entry.handlers.get(token):null;
      if(!handler)throw widgetError("button_expired","This button is no longer active.");
      await handler({...event,view:runtime.view(ref.widgetId,viewId),
        overlay:(node,options)=>overlay(ref,viewId,event,node,options),
        respond:answer=>request("respond",{ref,callbackId:event.callbackQueryId,answer})});
      return null;
    },
    async event(ref,{viewId,type,event}){
      return runtime.dispatchViewEvent(ref.widgetId,viewId,type,event);
    },
    async replaceStore(ref,{state}){
      return runtime.replaceStore(ref.widgetId,state);
    },
    async retire(ref){
      for(const [viewId,entry] of callbacks)
        if(entry.widgetId===ref.widgetId)callbacks.delete(viewId);
      try{await runtime.retire(ref.widgetId);}finally{refs.delete(ref.widgetId);}
    },
    async close(){for(const ref of [...refs.values()])await this.retire(ref);},
  };
}

async function main() {
  let line="";
  for await(const chunk of process.stdin){line+=chunk;if(line.length>L.frameBytes)throw widgetError("invalid_argument");if(line.includes("\n"))break;}
  const boot=JSON.parse(line);
  let rpc;
  const processRuntime=createReactWidgetProcess({request:(method,args)=>rpc.request(method,args)});
  rpc=await connectWidgetTransport({...boot,handle:async(method,args={})=>{
    if(!["load","mount","unmount","callback","event","replaceStore","retire"].includes(method))throw widgetError("access_denied");
    if(args.ref?.botId!==boot.owner.botId||args.ref?.agentId!==boot.owner.agentId)
      throw widgetError("access_denied");
    const {ref,...rest}=args;
    return processRuntime[method](ref,rest);
  }});
  const heart=setInterval(()=>void rpc.request("heartbeat",{}).catch(()=>process.exit(1)),L.heartbeatMs);
  process.on("SIGTERM",()=>{clearInterval(heart);void processRuntime.close().finally(()=>process.exit());});
}
if(process.argv.includes("--widget-runtime"))main().catch(()=>{console.error("widget_runtime_failed");process.exit(1);});
