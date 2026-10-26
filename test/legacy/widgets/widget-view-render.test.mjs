import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';

test('an uncertain first send retains a candidate without inventing a view or sending again',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Unknown'});
  f.failNextEdit('telegram_transport_failed');
  await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send:{}}),{code:'delivery_unknown'});
  assert.equal(f.store.listViews(w.widgetId).length,0);const [candidate]=f.store.listCandidates(w.widgetId);assert.ok(candidate.viewId);
  await f.manager.update(f.scope,{widgetId:w.widgetId});
  assert.equal(f.telegramCalls.filter(c=>c.method==='sendMessage').length,1);
  await f.manager.deleteView(f.scope,{viewId:candidate.viewId});assert.deepEqual(f.store.listCandidates(w.widgetId),[]);
});

test('unknown edits preserve state and bypass the view hash on the next explicit render',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView();let text='changed';f.module.render=()=>({text});
  f.failNextEdit('telegram_transport_failed');await f.manager.update(f.scope,{widgetId:one.widgetId});
  assert.equal(f.store.getView(one.viewId).deliveryUnknown,true);
  const before=f.telegramCalls.length;await f.manager.update(f.scope,{widgetId:one.widgetId});
  assert.ok(f.telegramCalls.length>before);assert.equal(f.store.getView(one.viewId).deliveryUnknown,false);
  assert.ok(f.store.getView(one.viewId).lastError,'an automatic/background-style repaint does not clear the latch');
});

test('failure to persist a confirmed replacement keeps the old binding and records uncertainty',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),replace=f.store.replaceView;
  f.store.replaceView=()=>{throw Object.assign(new Error('disk'),{code:'storage_failed'});};
  await assert.rejects(f.manager.setView(f.scope,{widgetId:one.widgetId,target:one.target,props:{part:'new'}}),{code:'storage_failed'});
  assert.equal(f.store.byTarget('b',one.target).id,one.viewId);assert.equal(f.store.getView(one.viewId).deliveryUnknown,true);
  f.store.replaceView=replace;
});

test('first render failure calls onError with attach context without a duplicate agent notice',async t=>{
  const errors=[],f=await widgetFixture(t,{module:{render(){throw new Error('bad render');},onError(_ctx,error,event){errors.push({error,event});return false;}}});
  const w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Broken'});
  await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send:{}}));
  assert.equal(errors.length,1);assert.equal(errors[0].error.operation,'attach');assert.ok(errors[0].error.view.id);
  assert.ok(f.store.get(w.widgetId).lastError);assert.equal(f.notices.length,0);
});

test('a confirmed first send remains identifiable when binding persistence fails',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Disk failure'});
  const create=f.store.createView;f.store.createView=()=>{throw new Error('disk failure');};
  let failure;try{await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{}});}catch(error){failure=error;}
  f.store.createView=create;
  assert.equal(failure.code,'storage_failed');assert.equal(failure.confirmedMessageId,7);
  assert.deepEqual(f.store.listCandidates(w.widgetId)[0].target,{chatId:1,messageId:7});
  assert.equal(f.store.listViews(w.widgetId).length,0);
});

test('inline URL media does not require a returned native Message for cache mapping',async t=>{
  const f=await widgetFixture(t,{module:{render:()=>({photo:'https://example.org/cat.jpg'})}});
  const w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Photo'});
  const result=await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'photo'}});
  assert.equal(f.store.getView(result.viewId).message.photo,'https://example.org/cat.jpg');
});

test('subsequent inline repaint authorizes no ordinary chat instead of SQL null',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Inline'});
  const view=await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'opaque'}});
  const result=await f.manager.update(f.scope,{widgetId:w.widgetId,state:{count:2}});
  assert.deepEqual(result.renderErrors,[]);assert.equal(f.store.getView(view.viewId).renderSpec.text,'game:2');
});
