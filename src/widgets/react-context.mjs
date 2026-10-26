import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import { widgetError } from "./contract.mjs";

export const WidgetInstanceContext = createContext(null);
export const WidgetViewContext = createContext(null);

function instance() {
  const value = useContext(WidgetInstanceContext);
  if (!value) throw widgetError("invalid_argument", "Widget hook outside a widget Runtime.");
  return value;
}
export function useWidget() { return instance().widget; }
export function useView() {
  const value = useContext(WidgetViewContext);
  if (!value) throw widgetError("invalid_argument", "useView requires a mounted view.");
  return value;
}
export function useViews() {
  const value=instance();
  return useSyncExternalStore(value.subscribeViews,value.getViews,value.getViews);
}
export function useTelegram() { return instance().telegram; }
export function useDispatch() { return instance().store.dispatch; }

export function useSelector(selector) {
  if (typeof selector !== "function") throw widgetError("invalid_argument", "Selector must be a function.");
  const store=instance().store;
  // Subscribe to the stable state object, then select during render. An inline
  // selector returning a new object cannot make React's snapshot check loop.
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  const selected=selector(state),cache=useRef({store:null,value:undefined});
  if(cache.current.store===store && Object.is(cache.current.value,selected)) return cache.current.value;
  cache.current={store,value:selected};
  return selected;
}
