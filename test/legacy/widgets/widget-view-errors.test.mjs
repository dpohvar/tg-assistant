import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';

test('explicit recovery authorizes the owner instead of the revoked stopped generation',async t=>{
  let f;f=await widgetFixture(t,{managerOptions:{authorize:ref=>{
    if(ref.widgetId&&f?.manager.isRevoked(ref))throw Object.assign(new Error('revoked'),{code:'widget_stopped'});
    return f?.scope;
  }}});
  const one=await f.withOneView();await f.manager.disableOwner(f.scope);
  await f.manager.update(f.scope,{widgetId:one.widgetId,handler:'counter.tsx'});
  assert.equal(f.store.get(one.widgetId).status,'active');assert.equal(f.store.listViews(one.widgetId).length,1);
});

test('failed onInit keeps partial state in a stopped repairable widget and reports the phase',async t=>{
  const f=await widgetFixture(t,{module:{onInit(ctx){ctx.state.partial=7;throw new Error('init exploded');}}});
  let id;await assert.rejects(f.manager.create(f.scope,{handler:'a.tsx',description:'Broken'}),error=>{id=error.widgetId;return error.code==='widget_init_failed'&&error.phase==='onInit'&&error.status==='stopped';});
  const w=f.store.get(id);assert.equal(w.status,'stopped');assert.equal(w.state.partial,7);assert.equal(w.pending,0);assert.equal(f.notices.length,0);
  f.module.onInit=ctx=>{ctx.state.fixed=true;};await f.manager.update(f.scope,{widgetId:id});assert.equal(f.store.get(id).status,'active');assert.equal(f.store.get(id).state.fixed,true);
});

test('active description-only updates repaint without lifecycle; state replacement preserves view IDs',async t=>{
  let init=0,stop=0;const f=await widgetFixture(t,{module:{onInit(){init++;},onStop(){stop++;}}}),one=await f.withOneView();
  await f.manager.update(f.scope,{widgetId:one.widgetId,description:'Renamed'});
  assert.equal(init,1);assert.equal(stop,0);assert.equal(f.store.get(one.widgetId).description,'Renamed');
  await f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:4}});assert.equal(init,2);assert.equal(stop,1);assert.ok(f.store.getView(one.viewId));
});

test('repeated background errors notify once and automatic successes do not clear the view latch',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView();
  for(let i=0;i<2;i++){f.failNextEdit();await f.runtime.dispatch(f.store.get(one.widgetId),{name:'increment',source:'local',data:{}});}
  assert.equal(f.notices.length,1);assert.ok(f.store.getView(one.viewId).lastError);
  await f.runtime.dispatch(f.store.get(one.widgetId),{name:'increment',source:'local',data:{}});assert.ok(f.store.getView(one.viewId).lastError);
  await f.manager.update(f.scope,{widgetId:one.widgetId,description:'Keep latch'});assert.ok(f.store.getView(one.viewId).lastError);
  await f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:9}});assert.equal(f.store.getView(one.viewId).lastError,null);
  f.failNextEdit();await f.runtime.dispatch(f.store.get(one.widgetId),{name:'increment',source:'local',data:{}});assert.equal(f.notices.length,2);
});

test('an onError failure is not recursive and retains original and secondary diagnostics',async t=>{
  let errors=0;const f=await widgetFixture(t,{module:{onError(){errors++;throw new Error('recovery failed');}}}),one=await f.withOneView();
  f.failNextEdit();await f.runtime.dispatch(f.store.get(one.widgetId),{name:'increment',source:'local',data:{}});
  assert.equal(errors,1);const error=f.store.getView(one.viewId).lastError;assert.equal(error.code,'telegram_api_error');assert.equal(error.secondaryError.message,'recovery failed');
});

test('zero-view timers commit state and stopping discards all pending work before recovery',async t=>{
  let stopped=0;const f=await widgetFixture(t,{module:{onInit(ctx){ctx.setTimeout(()=>ctx.enqueue('increment'),1);},onStop(){stopped++;}}}),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Timer'});
  await new Promise(r=>setTimeout(r,20));await f.idle();assert.equal(f.store.get(w.widgetId).state.count,1);assert.equal(f.telegramCalls.length,0);
  const current=f.store.get(w.widgetId);f.store.admit(current,{name:'increment',source:'agent',data:{},receivedAt:new Date().toISOString(),delayed:false});
  await f.manager.disableOwner(current);assert.equal(f.store.get(w.widgetId).status,'stopped');assert.equal(f.store.get(w.widgetId).pending,0);assert.equal(stopped,1);
});

test('a widget can delete itself from an action without waiting on that action',async t=>{
  const f=await widgetFixture(t,{module:{async remove(ctx){await ctx.api.delete_widget({widgetId:ctx.widgetId});}}}),one=await f.withOneView();
  await f.runtime.dispatch(f.store.get(one.widgetId),{name:'remove',source:'local',data:{}});await f.idle();assert.equal(f.store.get(one.widgetId),null);
});
