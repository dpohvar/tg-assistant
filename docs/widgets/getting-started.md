# Getting started with React widgets

[Widget handbook](../widgets.md) · [JSX](jsx.md) · [State](state.md) · [Views](views.md) · [Runtime](runtime.md)

A widget is a React application owned by one chat agent. It runs independently of model turns in that agent's sandboxed Node.js process. An instance has one saved JSON store and any number of message views. The `.tsx` source belongs in the agent's permanent bot workspace, not its temporary directory. Components mounted as durable views must be named exports. An optional default export is the instance's Runtime wrapper.

This complete counter uses supported JSX tags. There is no `<tg-message>`, `<tg-paragraph>`, or `<tg-row>` host tag:

```tsx
import React from "react";
import {defineStore,useSelector,useDispatch} from "@tg-assistant/widget";

defineStore({version:1,initialState:{count:0}});

export function Counter(){
  const count=useSelector(state=>state.count);
  const dispatch=useDispatch();
  return <>
    <p>Count: {count}</p>
    <tg-keyboard><tg-button-row>
      <tg-button onClick={()=>dispatch(state=>{state.count-=1;})}>−1</tg-button>
      <tg-button onClick={()=>dispatch(state=>{state.count=0;})}>Reset</tg-button>
      <tg-button onClick={()=>dispatch(state=>{state.count+=1;})}>+1</tg-button>
    </tg-button-row></tg-keyboard>
  </>;
}
```

Save it as `widgets/counter.tsx`, then call the agent's controller tools:

```js
const {widgetId}=await create_widget({handler:"widgets/counter.tsx",description:"Counter"});
await set_widget_view({widgetId,component:"Counter",send:{}});
```

`send:{}` publishes in the current chat. `send:{chatId,topicId?,reply_parameters?}` publishes in another authorized chat; `target:{chatId,messageId}` mounts onto an existing authorized bot message. An inline or guest publication uses its respective target or guest request. Creation sends one message and waits for Telegram confirmation. Do not blindly retry after an uncertain send. See [views and events](views.md) for view management and [agent contract](../agent-contract.md#widget-tools) for exact tool arguments.

The built-in `/help` describes controller commands, including `/help widget` for administrator commands. It does not execute widget JSX. To build a widget, use the agent tools above and this handbook. See [child-bot commands](../commands.md) for role requirements.
