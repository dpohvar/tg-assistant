import React from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import { hostNode,hostText,insertNode,removeNode } from "./host-tree.mjs";
import { WidgetInstanceContext,WidgetViewContext } from "./react-context.mjs";
import { loadWidgetModule } from "./module-registry.mjs";
import { createReactStore } from "./react-store.mjs";
import { validateReactMount, widgetError } from "./contract.mjs";
import { createViewHandle } from "./view-handles.mjs";
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
  function viewTree(instance,view) {
    const component=resolved(instance,view.component);
    if(!view.node&&typeof component!=="function")throw widgetError("invalid_argument","Unknown component export.");
    const element=view.node??h(component,{...view.props});
    return h(WidgetViewContext,{value:view.handle},
      h(ViewBoundary,{key:`${view.id}:${view.epoch}`,onError:error=>{
        view.status="error";view.error={code:"render_failed",message:String(error.message)};
        bridge?.viewError?.(instance.widgetId,view.id,view.error);
      }},h("widget-view",{viewId:view.id},element)));
  }
  async function render(instance) {
    const Wrapper=instance.module.exports.default ?? React.Fragment;
    const children=[...instance.views.values()].map(view=>h(React.Fragment,{key:view.id},viewTree(instance,view)));
    const body=Wrapper===React.Fragment?h(React.Fragment,null,...children)
      :h(Wrapper,{...instance.runtimeProps},...children);
    const tree=h(WidgetInstanceContext,{value:instance.context},
      h(RuntimeBoundary,{onError:error=>{
        instance.status="error";instance.error={code:"runtime_failed",message:String(error.message)};
        bridge?.runtimeError?.(instance.widgetId,instance.error);
      }},body));
    renderer.updateContainerSync(tree,instance.root,null,null);
    renderer.flushSyncWork();
    await instance.lastCommit;
  }
  const api={
    module(widgetId){return ensure(widgetId).module;},
    view(widgetId,viewId){return ensure(widgetId).views.get(viewId)?.handle??null;},
    findOverlay(widgetId,parentViewId,userId){
      return [...ensure(widgetId).views.values()].find(view=>
        view.parentViewId===parentViewId&&view.user?.id===userId)?.handle??null;
    },
    hasSubscription(widgetId,viewId,type){
      return (ensure(widgetId).views.get(viewId)?.subscriptions.get(type)?.size??0)>0;
    },
    async dispatchViewEvent(widgetId,viewId,type,event){
      const instance=ensure(widgetId),view=instance.views.get(viewId);
      if(!view)return false;
      const handlers=[...(view.subscriptions.get(type)??[])];
      for(const handler of handlers)await handler({...event,view:view.handle});
      return handlers.length>0;
    },
    deliverMessage(widgetId,viewId,message){
      const instance=ensure(widgetId),view=instance.views.get(viewId);
      if(!view)return;
      view.message=message;
      const next=message?.dice?[message.dice.value??null,message.dice.emoji??null]:[null,null];
      if(!Object.is(view.diceSnapshot[0],next[0])||!Object.is(view.diceSnapshot[1],next[1])){
        view.diceSnapshot=Object.freeze(next);
        for(const listener of view.diceListeners)listener();
      }
      const handlers=[...(view.subscriptions.get("message")??[])];
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
        waitForSave:()=>pendingSave};
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
        },
        notifyAgent:async payload=>{await instance.waitForSave();
          return bridge?.notifyAgent?.(widgetId,payload);},
        requestAgent:(payload,options)=>bridge?.requestAgent?.(widgetId,payload,options)};
      container.onCommit=()=>{
        const revision=store.revision,save=pendingSave;
        instance.lastCommit=Promise.resolve(save).then(()=>{
          if(store.revision!==revision)return;
          return bridge?.commit?.(widgetId,container.children,revision,instance.views);
        });
        instance.lastCommit.catch(error=>bridge?.runtimeError?.(widgetId,error));
      };
      instances.set(widgetId,instance);
      await render(instance);
      return instance.context.widget;
    },
    async mount({widgetId,viewId,component,props,node,options={},target=null,parentViewId=null,user=null,message=null,bindingEpoch,origin="agent"}) {
      const instance=ensure(widgetId);
      let view=instance.views.get(viewId);
      const currentTarget=target??view?.target;
      if(!currentTarget)throw widgetError("invalid_argument","A view target is required.");
      if(node!==undefined){
        if(!React.isValidElement(node))throw widgetError("invalid_argument","View renderer must be a React element.");
        const name=Object.entries(instance.module.exports).find(([,value])=>value===node.type)?.[0];
        component=name??node.type;props=node.props;
      }
      if(component===undefined)component=view?.component;
      validateReactMount({target:currentTarget,component,props:props??view?.props??{},origin});
      if(!view){
        view={id:viewId,component:null,props:{},epoch:0,status:"active",error:null,
          generation:instance.generation??1,target:currentTarget,parentViewId,
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
            const wasEmpty=handlers.size===0;
            handlers.add(callback);selected.subscriptions.set(type,handlers);
            if(wasEmpty&&type!=="message")bridge?.subscription?.(id,key,type,true);
            return()=>{
              handlers.delete(callback);
              if(!handlers.size&&type!=="message")bridge?.subscription?.(id,key,type,false);
            };
          }});
        instance.views.set(viewId,view);
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
      instance.viewSnapshot=Object.freeze([...instance.views.values()].map(v=>v.handle));
      for(const listener of instance.viewListeners)listener();
      await render(instance);
      return view.handle;
    },
    async replaceStore(widgetId,state){
      const instance=ensure(widgetId);
      instance.store.replace(state);
      await instance.waitForSave();
      await render(instance);
      return {revision:instance.store.revision,state:instance.store.getSnapshot()};
    },
    async unmount(widgetId,viewId,{controller=false}={}) {
      const instance=ensure(widgetId);
      if(!instance.views.has(viewId))return;
      if(!controller)await bridge?.unmount?.(widgetId,viewId);
      instance.views.delete(viewId);
      instance.viewSnapshot=Object.freeze([...instance.views.values()].map(v=>v.handle));
      for(const listener of instance.viewListeners)listener();
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
