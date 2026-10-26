import { widgetError } from "./contract.mjs";

/** Stable author-facing handle; every operation resolves the current view generation. */
export function createViewHandle({widgetId,viewId,generation,resolve,mount,unmount,list,subscribe}) {
  function live() {
    const current=resolve(widgetId,viewId);
    if (!current || current.generation!==generation) throw widgetError("view_not_found");
    return current;
  }
  const handle={
    get id(){return viewId;},
    get target(){return live().target??null;},
    get props(){return live().props;},
    get message(){return live().message??null;},
    get parent(){const parentId=live().parentViewId;return parentId?resolve(widgetId,parentId)?.handle??null:null;},
    get user(){return live().user??null;},
    get status(){return live().status;},
    get error(){return live().error;},
    subscribe(type,callback){live();return subscribe(widgetId,viewId,type,callback);},
    subscribeDice(callback){const view=live();view.diceListeners.add(callback);
      return()=>view.diceListeners.delete(callback);},
    getDice(){return live().diceSnapshot;},
    mount(node,options){live();return mount(widgetId,viewId,node,options);},
    unmount(){live();return unmount(widgetId,viewId);},
    closeOverlay(){return live().user?handle.unmount():undefined;},
    getOverlays(){live();return list(widgetId).filter(view=>view.parentViewId===viewId).map(view=>view.handle);},
  };
  return handle;
}
