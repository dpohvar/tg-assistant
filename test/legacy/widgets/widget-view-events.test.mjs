import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';

test('stopping drops queued button events and acknowledges them without text',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId);
  f.store.admit(w,{name:'increment',source:'button',data:{id:'queued',data:'increment'},receivedAt:new Date().toISOString(),delayed:false},{durable:false});
  await f.manager.disableOwner(f.scope);
  const answers=f.telegramCalls.filter(c=>c.method==='answerCallbackQuery'&&c.args.callback_query_id==='queued');
  assert.equal(answers.length,1);assert.equal(answers[0].args.text,undefined);assert.equal(f.handled.length,0);
});

test('inline callbacks use the exact source view without ordinary message IDs',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Inline'}),v=await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'opaque'}});
  assert.equal(await f.receiveButton(v.target),true);await f.idle();
  assert.equal(f.handled.length,1);assert.equal(f.handled[0].view.id,v.viewId);assert.equal(f.handled[0].data.inline_message_id,'opaque');
  assert.equal(f.store.get(w.widgetId).state.count,1);
});

test('buttons queued during render are validated against its newly confirmed keyboard',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView();
  const original=f.module.render;f.module.render=(state,view)=>state.count?{text:'No buttons'}:original(state,view);
  const block=f.blockNextPublish(),running=f.runtime.dispatch(f.store.get(one.widgetId),{name:'increment',source:'local',data:{}});
  await block.entered;await f.receiveButton(one.target);await f.receiveReply(one.target);block.release();await running;await f.idle();
  assert.equal(f.handled.filter(e=>e.source==='button').length,0);
  assert.equal(f.handled.filter(e=>e.source==='reply').length,1);
  assert.ok(f.telegramCalls.some(c=>c.method==='answerCallbackQuery'));
});

test('replacement admission cuts off late buttons while replies keep their source snapshot',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),block=f.blockNextPublish();
  f.module.render=(state,view)=>({text:`${view.props.part??''}:${state.count}`});
  const repaint=f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:1}});await block.entered;
  const replace=f.manager.setView(f.scope,{widgetId:one.widgetId,target:one.target,props:{part:'new'}});
  await f.receiveButton(one.target);await f.receiveReply(one.target);block.release();await repaint;await replace;await f.idle();
  assert.equal(f.handled.filter(e=>e.source==='button').length,0);
  const reply=f.handled.find(e=>e.source==='reply');assert.ok(reply);assert.equal(reply.view.id,one.viewId);
});

test('a detach breaks reply admission continuity even after reattachment at the same address',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId),old=f.store.getView(one.viewId);
  const event={name:'onReply',source:'reply',receivedAt:new Date().toISOString(),delayed:false,data:{text:'old'},view:{id:old.id,target:old.target,props:old.props}};
  const admitted=f.store.admit(w,event,{admission:{viewId:old.id,bindingEpoch:old.bindingEpoch,target:old.target}});
  f.store.detachView(w,old.id);await f.manager.setView(f.scope,{widgetId:w.widgetId,target:one.target});
  const result=await f.manager.begin(w,admitted.seq);assert.equal(result.name,'__ignore');assert.equal(f.handled.length,0);
});

test('events received during controller initialization wait and run against the new instance',async t=>{
  let release,enter;const entered=new Promise(r=>enter=r);
  const f=await widgetFixture(t),one=await f.withOneView(),load=f.host.load;
  f.host.load=async (...args)=>{enter();await new Promise(r=>release=r);return load(...args);};
  const update=f.manager.update(f.scope,{widgetId:one.widgetId,handler:'new.tsx'});await entered;
  const reply=f.receiveReply(one.target);release();await update;await reply;await f.idle();
  assert.equal(f.handled.filter(e=>e.source==='reply').length,1);
});
