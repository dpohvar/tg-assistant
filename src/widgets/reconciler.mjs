import React from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import { hostNode,hostText,insertNode,removeNode } from "./host-tree.mjs";
import { WidgetInstanceContext,WidgetViewContext } from "./react-context.mjs";
import { loadWidgetModule } from "./module-registry.mjs";
import { createReactStore } from "./react-store.mjs";
import { validateReactMount, plainJSON, widgetError } from "./contract.mjs";
import { createViewHandle } from "./view-handles.mjs";
import { projectHostTree } from "./projection.mjs";
import { randomUUID } from "node:crypto";

const h=React.createElement;
const renderer=Reconciler({
  supportsMutation:true,supportsPersistence:false,supportsHydration:false,
  isPrimaryRenderer:true,supportsMicrotasks:true,scheduleMicrotask:queueMicrotask,
  scheduleTimeout:setTimeout,cancelTimeout:clearTimeout,noTimeout:-1,
  getRootHostContext:()=>({}),getChildHostContext:parent=>parent,
  createInstance:(type,props)=>hostNode(type,props),
  createTextInstance:text=>hostText(text),
  appendInitialChild:insertNode,appendChild:insertNode,
  appendChildToContainer:insertNode,
  insertBefore:(parent,child,before)=>insertNode(parent,child,before),
  insertInContainerBefore:(container,child,before)=>insertNode(container,child,before),
  removeChild:removeNode,removeChildFromContainer:removeNode,
  clearContainer:container=>{for(const child of container.children)child.parent=null;container.children=[];},
  finalizeInitialChildren:()=>false,shouldSetTextContent:()=>false,
  getPublicInstance:instance=>instance,
  prepareForCommit:()=>null,
  resetAfterCommit:container=>container.onCommit?.(),
  preparePortalMount:()=>{},
  commitUpdate:(instance,type,oldProps,newProps)=>{instance.props=newProps;},
  commitTextUpdate:(instance,oldText,newText)=>{instance.text=String(newText);},
  resetTextContent:instance=>{instance.children=[];},
  getCurrentEventPriority:()=>DefaultEventPriority,
  getCurrentUpdatePriority:()=>DefaultEventPriority,
  setCurrentUpdatePriority:()=>{},
  resolveUpdatePriority:()=>DefaultEventPriority,
  trackSchedulerEvent:()=>{},resolveEventType:()=>null,resolveEventTimeStamp:()=>Date.now(),
  shouldAttemptEagerTransition:()=>false,
  maySuspendCommit:()=>false,
  preloadInstance:()=>true,
  startSuspendingCommit:()=>{},
  suspendInstance:()=>{},
  waitForCommitToBeReady:()=>null,
  detachDeletedInstance:()=>{},
});

class ViewBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error){this.props.onError(error);}
  render(){return this.state.error?null:this.props.children;}
}
class RuntimeBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error){this.props.onError(error);}
  render(){return this.state.error?null:this.props.children;}
}

export function createReactRuntime({ bridge, moduleRegistry=loadWidgetModule }={}) {
  const instances=new Map();
  const ensure=widgetId=>{
    const instance=instances.get(widgetId);
    if(!instance)throw widgetError("widget_stopped");
    return instance;
  };
  const resolved=(instance,component)=>typeof component==="string"
    ? instance.module.exports[component]:component;
  function renderedTree(instance,view,physicalId,role){
    const component=resolved(instance,view.component);
    if(!view.node&&typeof component!=="function")throw widgetError("invalid_argument","Unknown component export.");
    const element=view.node??h(component,{...view.props});
    return h(WidgetViewContext,{value:view.handle,key:role},
      h(ViewBoundary,{key:`${view.id}:${view.epoch}`,onError:error=>{
        view.status="error";view.error={code:"render_failed",message:String(error.message)};
        if(view.virtual){const parent=instance.views.get(view.parentViewId);
          if(parent){parent.status="error";parent.error=view.error;}}
        bridge?.viewError?.(instance.widgetId,physicalId,view.error);
      }},h("widget-view",{viewId:physicalId,role},element)));
  }
  function viewTree(instance,view){
    const child=view.activeVirtualId?instance.views.get(view.activeVirtualId):null;
    return h(React.Fragment,null,renderedTree(instance,view,view.id,"parent"),
      child?renderedTree(instance,child,view.id,"overlay"):null);
  }
  function refreshViews(instance){
    instance.viewSnapshot=Object.freeze([...instance.views.values()].map(view=>view.handle));
    for(const listener of instance.viewListeners)listener();
  }
  function syncWireSubscription(instance,parentId,type){
    if(type==="message")return;
    const parent=instance.views.get(parentId);
    const active=instance.views.get(parent?.activeVirtualId)??parent;
    const wanted=Boolean(active?.subscriptions.get(type)?.size);
    const key=`${parentId}:${type}`,previous=instance.wireSubscriptions.has(key);
    if(wanted===previous)return;
    if(wanted)instance.wireSubscriptions.add(key);
    else instance.wireSubscriptions.delete(key);
    bridge?.subscription?.(instance.widgetId,parentId,type,wanted);
  }
  function dropVirtual(instance,parent){
    const child=parent.activeVirtualId?instance.views.get(parent.activeVirtualId):null;
    if(!child)return;
    instance.views.delete(child.id);
    parent.activeVirtualId=null;parent.underlayProjection=null;
    for(const type of ["reply","reaction"])syncWireSubscription(instance,parent.id,type);
    refreshViews(instance);
  }
  async function render(instance) {
    const Wrapper=instance.module.exports.default ?? React.Fragment;
    const children=[...instance.views.values()].filter(view=>!view.virtual)
      .map(view=>h(React.Fragment,{key:view.id},viewTree(instance,view)));
    const body=Wrapper===React.Fragment?h(React.Fragment,null,...children)
      :h(Wrapper,{...instance.runtimeProps},...children);
    const tree=h(WidgetInstanceContext,{value:instance.context},
      h(RuntimeBoundary,{onError:error=>{
        instance.status="error";instance.error={code:"runtime_failed",message:String(error.message)};
        bridge?.runtimeError?.(instance.widgetId,instance.error);
      }},body));
    const before=instance.commitIndex;
    renderer.updateContainerSync(tree,instance.root,null,null);
    renderer.flushSyncWork();
    const changed=[];
    for(const parent of instance.views.values())if(parent.activeVirtualId&&parent.underlayProjection){
      const underlay=instance.container.children.find(node=>node.type==="widget-view"&&
        node.props.viewId===parent.id&&node.props.role==="parent");
      if(!underlay)continue;
      try{
        const next=projectHostTree(underlay,{priorBody:parent.underlayProjection.body});
        if(JSON.stringify({body:next.body,replyMarkup:next.replyMarkup})!==
            JSON.stringify(parent.underlayProjection))changed.push(parent);
      }catch{changed.push(parent);}
    }
    if(changed.length){
      for(let index=before+1;index<=instance.commitIndex;index++)instance.skippedCommits.add(index);
      for(const parent of changed)dropVirtual(instance,parent);
      return render(instance);
    }
    return await instance.lastCommit;
  }
  function checkedPublication(instance,outcome){
    const updatedViews=outcome?.updatedViews??[],failedViews=[...(outcome?.failedViews??[])];
    const reported=new Set(failedViews.map(view=>view.viewId));
    for(const view of instance.views.values())if(view.status==="error"&&!reported.has(view.id))
      failedViews.push({viewId:view.id,target:view.target,error:view.error??{code:"render_failed"}});
    if(instance.status==="error")throw Object.assign(widgetError("runtime_failed",instance.error?.message),
      {updatedViews,failedViews});
    if(failedViews.length)throw Object.assign(widgetError("view_render_failed",
      `${failedViews.length} widget view(s) were not published.`),{updatedViews,failedViews});
    return {updatedViews};
  }
  async function applyStoreChange(instance,change){
    const collector={after:instance.commitIndex,records:[]};
    instance.collectors.add(collector);
    try{
      change();
      let stable=false;
      for(let attempt=0;attempt<5;attempt++){
        const revision=instance.store.revision;
        await instance.waitForSave();
        await render(instance);
        if(instance.store.revision===revision){stable=true;break;}
      }
      if(!stable)throw widgetError("stale_revision",
        "The widget store kept changing during publication.");
      const updated=new Map(),failed=new Map();
      for(const record of collector.records){
        for(const view of record.result?.updatedViews??[])updated.set(view.viewId,view);
        for(const view of record.result?.failedViews??[])failed.set(view.viewId,view);
      }
      return checkedPublication(instance,{updatedViews:[...updated.values()],failedViews:[...failed.values()]});
    }finally{instance.collectors.delete(collector);}
  }
  const api={
    module(widgetId){return ensure(widgetId).module;},
    view(widgetId,viewId){return ensure(widgetId).views.get(viewId)?.handle??null;},
    activeView(widgetId,viewId){
      const instance=ensure(widgetId),view=instance.views.get(viewId);
      return instance.views.get(view?.activeVirtualId)?.handle??view?.handle??null;
    },
    findOverlay(widgetId,parentViewId,userId){
      return [...ensure(widgetId).views.values()].find(view=>
        view.parentViewId===parentViewId&&view.user?.id===userId)?.handle??null;
    },
    hasSubscription(widgetId,viewId,type){
      const instance=ensure(widgetId),parent=instance.views.get(viewId);
      const view=instance.views.get(parent?.activeVirtualId)??parent;
      return (view?.subscriptions.get(type)?.size??0)>0;
    },
    async dispatchViewEvent(widgetId,viewId,type,event){
      const instance=ensure(widgetId),physical=instance.views.get(viewId);
      const view=instance.views.get(physical?.activeVirtualId)??physical;
      if(!view)return false;
      const handlers=[...(view.subscriptions.get(type)??[])];
      for(const handler of handlers)await handler({...event,view:view.handle});
      return handlers.length>0;
    },
    deliverMessage(widgetId,viewId,message){
      const instance=ensure(widgetId),view=instance.views.get(viewId);
      if(!view)return;
      view.message=message;
      const active=instance.views.get(view.activeVirtualId);
      if(active)active.message=message;
      const next=message?.dice?[message.dice.value??null,message.dice.emoji??null]:[null,null];
      if(!Object.is(view.diceSnapshot[0],next[0])||!Object.is(view.diceSnapshot[1],next[1])){
        view.diceSnapshot=Object.freeze(next);
        for(const listener of view.diceListeners)listener();
      }
      const handlers=[...((active??view).subscriptions.get("message")??[])];
      queueMicrotask(()=>{for(const handler of handlers)
        Promise.resolve().then(()=>handler(message)).catch(error=>bridge?.viewError?.(widgetId,viewId,error));});
    },
    state(widgetId){const instance=ensure(widgetId);return {state:instance.store.getSnapshot(),
      version:instance.store.version,revision:instance.store.revision};},
    async create({widgetId,buildId,generation=1,factory,props={},saved}) {
      if(instances.has(widgetId))throw widgetError("view_conflict","Widget already loaded.");
      const module=await moduleRegistry(buildId,factory);
      let pendingSave=Promise.resolve();
      const store=createReactStore({definition:module.storeDefinition,saved,
        onRevision:revision=>{pendingSave=pendingSave.then(()=>bridge?.storeRevision?.(widgetId,revision));}});
      const container={children:[],onCommit:null};
      const root=renderer.createContainer(container,0,null,false,null,"",
        error=>bridge?.runtimeError?.(widgetId,error),
        error=>bridge?.runtimeError?.(widgetId,error),
        error=>bridge?.runtimeError?.(widgetId,error),null);
      const instance={widgetId,module,store,root,container,views:new Map(),runtimeProps:props,generation,
        status:"active",error:null,viewListeners:new Set(),viewSnapshot:Object.freeze([]),
        waitForSave:()=>pendingSave,commitIndex:0,skippedCommits:new Set(),
        wireSubscriptions:new Set(),
        collectors:new Set(),lastCommit:Promise.resolve()};
      instance.context={store,widget:null,telegram:bridge?.telegramFor?.(widgetId)??{},
        subscribeViews:callback=>{instance.viewListeners.add(callback);return()=>instance.viewListeners.delete(callback);},
        getViews:()=>instance.viewSnapshot};
      const viewIdFor=selector=>typeof selector==="string"?selector:
        [...instance.views.values()].find(view=>JSON.stringify(view.target)===JSON.stringify(selector))?.id;
      instance.context.widget={id:widgetId,
        mount:async(target,node,options)=>api.mount({widgetId,viewId:typeof target==="string"?target:
          "v"+randomUUID().replaceAll("-",""),target:typeof target==="string"?undefined:target,node,options,origin:"runtime"}),
        unmount:async selector=>api.unmount(widgetId,viewIdFor(selector)),
        getView:selector=>instance.views.get(viewIdFor(selector))?.handle??null,
        closeOverlays:async selector=>{
          const parentViewId=viewIdFor(selector);
          if(!parentViewId)throw widgetError("view_not_found");
          const closed=await bridge?.closeOverlays?.(widgetId,parentViewId)??[];
          for(const childId of closed)if(instance.views.has(childId))
            await api.unmount(widgetId,childId,{controller:true});
          const virtual=instance.views.get(parentViewId)?.activeVirtualId;
          if(virtual)await api.unmount(widgetId,virtual);
        },
        notifyAgent:async payload=>{await instance.waitForSave();
          return bridge?.notifyAgent?.(widgetId,payload);},
        requestAgent:(payload,options)=>bridge?.requestAgent?.(widgetId,payload,options)};
      container.onCommit=()=>{
        const revision=store.revision,save=pendingSave;
        const index=++instance.commitIndex,previous=instance.lastCommit;
        instance.lastCommit=Promise.resolve(previous).catch(()=>{}).then(()=>save).then(()=>{
          if(instance.skippedCommits.delete(index)||store.revision!==revision)return;
          return bridge?.commit?.(widgetId,container.children,revision,instance.views);
        }).then(result=>{
          for(const collector of instance.collectors)if(index>collector.after)
            collector.records.push({revision,result});
          return result;
        });
        instance.lastCommit.catch(error=>bridge?.runtimeError?.(widgetId,error));
      };
      instances.set(widgetId,instance);
      await render(instance);
      return instance.context.widget;
    },
    async mount({widgetId,viewId,component,props,node,options={},target=null,parentViewId=null,
      user=null,message=null,bindingEpoch,origin="agent",virtual=false}) {
      const instance=ensure(widgetId);
      let view=instance.views.get(viewId);
      virtual=virtual||Boolean(view?.virtual);
      const parent=virtual?instance.views.get(parentViewId??view?.parentViewId):null;
      const recipient=user?.id??view?.user?.id;
      const confirmedPrivateParent=parent&&(
        parent.target?.chatId===recipient&&Number.isSafeInteger(parent.target?.messageId)||
        parent.target?.receiverUserId===recipient&&
          Number.isSafeInteger(parent.target?.ephemeralMessageId));
      if(virtual&&(!parent||parent.virtual||!Number.isSafeInteger(recipient)||
          recipient<1||!confirmedPrivateParent))
        throw widgetError("invalid_argument","Virtual overlays need a confirmed private parent view.");
      const currentTarget=target??view?.target;
      if(!currentTarget)throw widgetError("invalid_argument","A view target is required.");
      if(node!==undefined){
        if(!React.isValidElement(node))throw widgetError("invalid_argument","View renderer must be a React element.");
        const name=Object.entries(instance.module.exports).find(([,value])=>value===node.type)?.[0];
        component=name??node.type;props=node.props;
      }
      if(component===undefined)component=view?.component;
      validateReactMount({target:currentTarget,component,props:props??view?.props??{},origin,virtual});
      if(virtual&&!view){
        if(parent.activeVirtualId)dropVirtual(instance,parent);
        const root=instance.container.children.find(item=>item.type==="widget-view"&&
          item.props.viewId===parent.id&&item.props.role==="parent");
        if(!root)throw widgetError("view_not_found","Parent has no rendered message.");
        const underlay=projectHostTree(root,{priorBody:parent.projection?.body});
        if(underlay.kind!=="rich_message")throw widgetError("render_failed",
          "Private virtual overlays require a rich-message parent.");
        parent.underlayProjection={body:underlay.body,replyMarkup:underlay.replyMarkup};
      }else if(view?.activeVirtualId)dropVirtual(instance,view);
      if(!view){
        view={id:viewId,component:null,props:{},epoch:0,status:"active",error:null,
          generation:instance.generation??1,target:currentTarget,parentViewId,virtual,
          user:user??(currentTarget.receiverUserId?{id:currentTarget.receiverUserId}:null),message,
          bindingEpoch:bindingEpoch??"e"+randomUUID().replaceAll("-",""),subscriptions:new Map(),
          diceListeners:new Set(),diceSnapshot:Object.freeze(message?.dice?
            [message.dice.value??null,message.dice.emoji??null]:[null,null])};
        view.handle=createViewHandle({widgetId,viewId,generation:view.generation,
          resolve:(id,key)=>instances.get(id)?.views.get(key),
          mount:(id,key,next,opts)=>api.mount({widgetId:id,viewId:key,...(next===undefined?{}:{node:next}),options:opts??{},origin:"runtime"}),
          unmount:api.unmount,list:id=>[...ensure(id).views.values()],
          subscribe:(id,key,type,callback)=>{
            const selected=ensure(id).views.get(key);
            if(!selected)throw widgetError("view_not_found");
            const handlers=selected.subscriptions.get(type)??new Set();
            handlers.add(callback);selected.subscriptions.set(type,handlers);
            const wireId=selected.virtual?selected.parentViewId:key;
            syncWireSubscription(ensure(id),wireId,type);
            return()=>{
              handlers.delete(callback);
              syncWireSubscription(ensure(id),wireId,type);
            };
          }});
        instance.views.set(viewId,view);
        if(virtual){parent.activeVirtualId=viewId;
          for(const type of ["reply","reaction"])syncWireSubscription(instance,parent.id,type);}
      }
      const rendererKey=node?.key??view.rendererKey??null;
      if(component===undefined)component=view.component;
      if(component===null)throw widgetError("invalid_argument","View has no renderer.");
      if(resolved(instance,view.component)!==resolved(instance,component) ||
         (node!==undefined&&view.rendererKey!==rendererKey) || options.force || view.status==="error")view.epoch++;
      if(node===undefined && resolved(instance,view.component)!==resolved(instance,component))view.node=null;
      view.component=component;view.node=node??(node===undefined?view.node:null);
      view.props=props??view.props;view.rendererKey=rendererKey;
      view.status="active";view.error=null;
      if(virtual){parent.status="active";parent.error=null;}
      refreshViews(instance);
      await render(instance);
      return view.handle;
    },
    async replaceStore(widgetId,state){
      const instance=ensure(widgetId);
      return applyStoreChange(instance,()=>instance.store.replace(state));
    },
    async dispatchAction(widgetId,action,args={}){
      const instance=ensure(widgetId);
      if(typeof action!=="string"||!/^[a-z][A-Za-z0-9_]*$/.test(action))
        throw widgetError("invalid_argument","Action name must start with a lowercase letter.");
      if(!args||typeof args!=="object"||Array.isArray(args))
        throw widgetError("invalid_argument","Action arguments must be a JSON object.");
      plainJSON(args);
      const factory=Object.hasOwn(instance.module.exports,action)?instance.module.exports[action]:null;
      if(typeof factory!=="function"||factory.constructor.name==="AsyncFunction")
        throw widgetError("invalid_argument","Unknown or asynchronous widget action.");
      const recipe=factory(args);
      if(typeof recipe!=="function")
        throw widgetError("invalid_argument","Widget action must return a synchronous store recipe.");
      return applyStoreChange(instance,()=>instance.store.dispatch(recipe));
    },
    async unmount(widgetId,viewId,{controller=false}={}) {
      const instance=ensure(widgetId);
      const view=instance.views.get(viewId);
      if(!view)return;
      if(view.virtual){
        const parent=instance.views.get(view.parentViewId);
        if(parent)dropVirtual(instance,parent);
        return render(instance);
      }
      if(view.activeVirtualId)dropVirtual(instance,view);
      if(!controller)await bridge?.unmount?.(widgetId,viewId);
      instance.views.delete(viewId);
      for(const type of ["reply","reaction"])syncWireSubscription(instance,viewId,type);
      refreshViews(instance);
      await render(instance);
    },
    describe(widgetId,viewId) {
      const instance=ensure(widgetId),view=instance.views.get(viewId);
      if(!view)return null;
      const tree=instance.container.children.find(node=>node.type==="widget-view"&&node.props.viewId===viewId);
      return {id:viewId,status:view.status,error:view.error,tree,store:instance.store.getSnapshot()};
    },
    async retire(widgetId) {
      const instance=ensure(widgetId);
      renderer.updateContainerSync(null,instance.root,null,null);
      renderer.flushSyncWork();
      instances.delete(widgetId);
    },
  };
  return api;
}
