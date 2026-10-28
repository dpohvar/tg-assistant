# React widgets

This is the stable entry point for the current React-widget API. For authoring, read [getting started](widgets/getting-started.md), the [JSX tag and layout reference](widgets/jsx.md), [state and lifecycle](widgets/state.md), [views and events](widgets/views.md), and [Node.js capabilities and limits](widgets/runtime.md). These chapters describe implemented behavior; [development notes](dev/react-widgets-design.md) contain historical alternatives, including JSX tags that were never implemented.

A widget is a sandboxed React application owned by one chat agent. One widget instance has one persistent JSON store and zero or more Telegram message views. A view mounts an exported component onto a new message, an existing bot message, or an inline/guest publication. Multiple views of the same widget share its store; local React state and refs belong to the running process.

## Create and publish

Write a permanent TSX file in the agent workspace, then call the controller tools:

```ts
const {widgetId} = await create_widget({handler:"widgets/counter.tsx",description:"Counter"});
const {viewId,target} = await set_widget_view({widgetId,component:"Counter",send:{}});
```

`send:{}` uses the current chat. `send:{chatId,topicId?,reply_parameters?}` creates a message in another authorized chat. `send:{guestRequestId}` publishes as the direct guest answer. `target:{chatId,messageId}` mounts on an existing authorized bot message, and `target:{inlineMessageId}` mounts on an owned inline publication. The first successful publication establishes the address; a failed or uncertain send is never blindly repeated.

For a one-player game, the [Wordle example](../examples/widgets/wordle/README.md) mounts `GameInput` alone, without `Players`. In a private chat, its start button opens a virtual overlay in the same message. In a group, a standalone recipient-only `GameInput` view can do the same in its hidden message; a public launcher still opens a separate ephemeral message for the player.

For a group or supergroup view whose rich content contains custom emoji and will be edited, create its message as a reply to a stable message in that chat: `send:{chatId,reply_parameters:{message_id:anchorMessageId}}`. In live tests, editing a standalone rich message replaced custom-emoji tiles with fallback characters; editing a reply-created message preserved them. An edit cannot add a reply anchor to an existing publication.

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
      <tg-button onClick={()=>dispatch(state=>{state.count++;})}>Increase</tg-button>
    </tg-button-row></tg-keyboard>
  </>;
}
```

`defineStore` may run once during module evaluation. If omitted, the widget starts with store version 0 and `{}`. Each widget instance gets an independent store even when instances reuse the same compiled module. Store recipes are synchronous Immer recipes; they must not return a value or perform I/O. `useSelector` subscribes to the current saved state. A changed state is persisted before its rendered message is sent or edited. The optional `default` export is a Runtime wrapper around all the instance's mounted views; it runs even with zero views and receives JSON `create_widget.props`.

Export a lowercase action factory when the agent needs to change the store without replacing the complete object. The factory receives one JSON object and returns a synchronous Immer recipe. For example, `export const resetCount=({value=0})=>state=>{state.count=value;};` can be called with `dispatch_widget_action({widgetId,action:"resetCount",args:{value:3}})`. Uppercase exports remain view components. An action cannot return a replacement state, perform I/O, or be async.

`update_widget({widgetId,handler?,description?,props?})` replaces the build or Runtime props while retaining ordinary view identities and store state. It closes existing ephemeral views before replacing the build. A new source version can migrate state with `defineStore({version,initialState:(oldState,oldVersion)=>...})`. `update_widget_store({widgetId,state})` replaces the complete JSON store without invoking button handlers; `dispatch_widget_action({widgetId,action,args?})` invokes an exported action. Both save the state and wait for affected views to receive Telegram's send/edit confirmation. They return `{updatedViews:[{viewId,target}]}` for confirmed message changes; an unchanged view does not appear. A failed view makes the tool reject with `updatedViews` and `failedViews`, even if the state was already saved or another view was successfully edited. Repair an errored view explicitly with `view.mount()`; there is no automatic retry. After a successful awaited action, `delete_widget` can follow immediately: widget operations are ordered and deletion keeps the final message body while disabling its buttons. `get_widget` returns store, view addresses, component names, props, status and errors. `list_widgets` reports runtime memory usage and its limit. Use `delete_widget_view` or `delete_widget` to detach bindings.

## Views and events

Use `useView()` inside a mounted view. It exposes `id`, `target`, `props`, `message`, `status`, `error`, `parent`, and `user` (`null` for public views). `view.mount(<Component {...props}/>)` updates that view; changing only props preserves component state, changing the component remounts it, and `{force:true}` forces a remount. `view.mount()` retries the retained renderer. `view.unmount()` removes the binding. `view.closeOverlay()` removes a private overlay and safely does nothing on a public view. `view.getOverlays()` returns its children. `useViews()` reacts to the instance's current view list.

`useWidget()` exposes `id`, `mount(targetOrViewId,node,{force?})`, `unmount`, `closeOverlays`, and `getView`. `widget.mount` is the path for a component to create a new message view. A callback on an ordinary public group message can open a recipient-only overlay with `event.overlay(<Game />)`. A repeat for the same user and public parent updates that overlay; another user gets an independent one. `event.respond(...)` answers the callback. Guest and inline views have no ordinary chat address for overlays.

In a private chat, `event.overlay(<Game />)` opens a process-local child view in the same ordinary message. The child has `view.user` and `view.parent`; `view.closeOverlay()` restores the parent's rendering without deleting the message. If the parent's rendered output changes, the child closes and the parent takes over the message, matching parent edits in groups. Restart also discards the virtual child and restores the parent. No additional ephemeral Telegram message is sent.

The parent view is edited only after its overlays are closed. If Telegram reports `MESSAGE_NOT_FOUND` while removing a private view, the controller still clears its local binding, so a later public button click can open a fresh overlay. User interaction renews a private view's 20-minute idle lifetime; background repaints do not. Private views close on restart. The store and ordinary views restore with their saved binding identity, so a subsequent store update can repaint them; pending callbacks and local React state do not replay.

`useOnMessage(callback)` runs after each confirmed send or edit. `useOnReply(callback,{disabled?})` opts into replies to this view; an active handler receives the reply instead of the chat agent. `useOnReaction` receives identified reaction changes. `useDice()` reads the last confirmed native dice result. These hooks clean up when their component unmounts. A callback token works only while present in the current confirmed projection.

`useTelegram()` exposes scoped controller methods including `send`, `edit`, `delete`, `read`, `download`, and `ws_open`/`ws_pull`/`ws_send`/`ws_close`/`ws_delete` for a shared Runtime WebSocket. The socket belongs to the agent's existing quota; a Runtime effect should close and delete it during cleanup. Ordinary edits and deletes of a widget-owned message detach that view after Telegram confirms the operation. Authorize targets and roles exactly as for an agent tool call.

## Output and media

Return one rich message tree, `<tg-dice emoji="🎲"/>`, or `<tg-sticker src="..."/>` from each view. Text/rich elements and `<tg-keyboard>` rows can be composed in React components; multiple keyboards concatenate rows. Rich, dice and sticker bodies cannot be converted into one another in an existing message. Dice and sticker content are creation-only; their keyboard can still change. An empty rich paragraph produces an intentionally blank message. Native media `file:path` is read from the owner's managed files and uploaded by the controller. Inline messages need public URLs or an existing Telegram file ID.

A callback may call `await widget.notifyAgent({text})` to queue a normal `widget_message`. For a JSON reply, call `widget.requestAgent({text,data?,responseSchema?},{timeoutMs?,signal?})`; provide a timeout or AbortSignal. The agent receives `widget_request` with `requestId` and answers using `answer_widget_request({requestId,result})`. Invalid schema results can be corrected before the original deadline. The ordinary end of an agent turn is not a reply. Cancelling an unstarted request removes it from the queue; widget replacement, deletion and process failure reject outstanding requests.

The pre-React `render(state,view)` module format, named action callbacks and `widget_event` tool were retired at schema 21. Existing registrations are removed during upgrade; confirmed legacy publications are queued for best-effort button cleanup. See [React Wordle](dev/react-wordle-spec.md) and the [development plan](dev/plans/2026-10-26-react-widgets-wordle.md) for the migrated game example.
