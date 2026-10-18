import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';
import {createWidgetStop} from '../../src/widgets/native-stop.mjs';
test('native stop requires an explicit owned view and updates only its projection',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),second=await f.manager.setView(f.scope,{widgetId:one.widgetId,send:{}}),w=f.store.get(one.widgetId);
  const calls=[],stop=createWidgetStop({store:f.store,authorize:()=>f.scope,telegram:{call:async(_b,method,args)=>{calls.push({method,args});return {id:'poll',is_closed:true};}}});
  await assert.rejects(stop(w,'stop_poll',{}),{code:'invalid_argument'});
  await stop(w,'stop_poll',{viewId:second.viewId});
  assert.equal(f.store.getView(second.viewId).message.poll.is_closed,true);
  assert.equal(f.store.getView(one.viewId).message.poll,undefined);
  assert.equal(calls[0].args.message_id,second.target.messageId);
});
test('inline live location stop uses opaque address and inline polls are rejected before Telegram',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Inline'}),view=await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'opaque'}}),ref=f.store.get(w.widgetId);
  let call;const stop=createWidgetStop({store:f.store,authorize:()=>f.scope,telegram:{call:async(_b,method,args)=>{call={method,args};return true;}}});
  await assert.rejects(stop(ref,'stop_poll',{viewId:view.viewId}),{code:'invalid_argument'});
  await stop(ref,'stop_live_location',{viewId:view.viewId});assert.deepEqual(call.args,{inline_message_id:'opaque'});
});
