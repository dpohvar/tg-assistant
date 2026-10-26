import {useLayoutEffect,useRef,useSyncExternalStore} from "react";
import {useView} from "./react-context.mjs";
import {widgetError} from "./contract.mjs";

function useSubscription(type,callback,{disabled=false}={}) {
  const view=useView(),latest=useRef(callback);
  latest.current=callback;
  if(typeof callback!=="function")throw widgetError("invalid_argument","A subscription callback is required.");
  useLayoutEffect(()=>disabled?undefined:view.subscribe(type,event=>latest.current(event)),[view,type,disabled]);
}
export function useOnMessage(callback){useSubscription("message",callback);}
export function useOnReply(callback,options){useSubscription("reply",callback,options);}
export function useOnReaction(callback,options){useSubscription("reaction",callback,options);}
export function useDice(){
  const view=useView();
  return useSyncExternalStore(view.subscribeDice,view.getDice,view.getDice);
}
