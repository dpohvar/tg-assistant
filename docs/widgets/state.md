# State, components and persistence

[Widget handbook](../widgets.md) · [Getting started](getting-started.md) · [JSX](jsx.md) · [Views](views.md) · [Runtime](runtime.md)

Each widget instance owns one JSON store, even when several instances reuse the same compiled source file. Declare it once while the module initializes:

```tsx
import {defineStore,useSelector,useDispatch} from "@tg-assistant/widget";

defineStore({version:1,initialState:{count:0}});

export function Count(){
  const count=useSelector(state=>state.count);
  const dispatch=useDispatch();
  return <tg-button-row>
    <tg-button onClick={()=>dispatch(state=>{state.count+=1;})}>
      Count: {count}
    </tg-button>
  </tg-button-row>;
}
```

If `defineStore` is omitted, the store starts at version 0 with `{}`. A second or late call throws. `useSelector` subscribes a component to the selected value. `useDispatch` takes a synchronous Immer recipe; mutate the draft, do not perform I/O in the recipe and do not return a replacement value. A store change is saved before view publication or edit. Store values must be JSON serializable. `update_widget_store({widgetId,state})` replaces the complete store without calling button handlers.

For a schema change, increase `version` and use an initializer function. It receives the prior state and version and returns a complete new JSON state:

```tsx
defineStore({
  version:2,
  initialState:(oldState,oldVersion)=>oldVersion<2
    ? {count:Number(oldState?.count??0),label:"Clicks"}
    : oldState,
});
```

An optional default export is the Runtime component. It wraps all views through `children`, receives JSON `create_widget.props`, and runs even when there are no views. Put instance-wide WebSocket or timer effects there; React context from this wrapper is visible to every view of that instance. Do not create an instance-specific connection at module scope, because compiled code can be reused by several widget instances.

```tsx
import React,{useEffect} from "react";

export default function Runtime({children}){
  useEffect(()=>{
    const timer=setInterval(()=>{/* instance-wide work */},60_000);
    return ()=>clearInterval(timer);
  },[]);
  return children;
}
```

Ordinary React `useState` and `useRef` are process-local. They, callback closures, effects, and in-flight requests disappear on restart. The JSON store and ordinary view bindings restore; private overlays close. An ordinary view's exported component name and JSON props are saved, so public views must use exported components and serializable props. See [views](views.md) for remounting and failure recovery.
