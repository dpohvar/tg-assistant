import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';

const stoppedError=()=>Object.assign(new Error('widget_stopped'),{code:'widget_stopped'});

test('create, active replacement and stopped recovery preserve all message and view identities',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),before=f.store.get(one.widgetId);
  await f.manager.update(f.scope,{widgetId:one.widgetId,handler:'b.tsx',description:'Second'});
  assert.equal(f.store.get(one.widgetId).generation,before.generation+1);assert.equal(f.store.getView(one.viewId).target.messageId,one.target.messageId);
  await f.manager.disableOwner(before,'test');assert.equal(f.store.get(one.widgetId).pending,0);
  await f.manager.update(f.scope,{widgetId:one.widgetId});assert.equal(f.store.get(one.widgetId).status,'active');assert.ok(f.store.getView(one.viewId));
});

test('unhandled view errors stay isolated and do not revoke a healthy runtime',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId);let released=0;f.host.release=async()=>released++;
  await f.manager.error(w,{code:'render_failed',message:'Bad render'},one.viewId);
  assert.equal(f.store.get(w.widgetId).status,'active');assert.equal(f.manager.isRevoked(w),false);assert.equal(released,0);assert.equal(f.notices.length,1);
});

test('close drains a pending creation and prevents late registration or publication',async t=>{
  let finish,enter;const entered=new Promise(r=>enter=r);
  const f=await widgetFixture(t,{managerOptions:{build:async()=>{enter();await new Promise(r=>finish=r);return {snapshotId:'s'};}}});
  const create=f.manager.create(f.scope,{handler:'a.tsx',description:'Pending'}),rejected=assert.rejects(create,/widget_stopped/);await entered;
  let done=false;const closing=f.manager.close().then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,false);finish();await rejected;await closing;assert.equal(f.telegramCalls.length,0);
});

test('foreign ownership rejects state, update, event, view and deletion',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),other={...f.scope,agentId:'foreign'};
  assert.throws(()=>f.manager.state(other,{widgetId:one.widgetId}),/widget_not_found/);
  for(const action of [()=>f.manager.update(other,{widgetId:one.widgetId}),()=>f.manager.event(other,{widgetId:one.widgetId,name:'increment'}),()=>f.manager.setView(other,{widgetId:one.widgetId,send:{}}),()=>f.manager.deleteView(other,{viewId:one.viewId}),()=>f.manager.delete(other,{widgetId:one.widgetId})])await assert.rejects(action,/widget_not_found/);
});

test('uncertain first sends stay diagnostic candidates without creating or stopping a view',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Unknown'});f.failNextEdit('telegram_transport_failed');
  await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send:{}}),e=>e.code==='delivery_unknown'&&e.widgetId===w.widgetId&&Boolean(e.viewId));
  assert.equal(f.store.get(w.widgetId).status,'active');assert.equal(f.store.listViews(w.widgetId).length,0);assert.equal(f.store.listCandidates(w.widgetId).length,1);
  const before=f.telegramCalls.length;await f.manager.update(f.scope,{widgetId:w.widgetId});assert.equal(f.telegramCalls.length,before);
});

test('stopped widgets reject new events and update restarts without replaying old pending work',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId);
  f.store.admit(w,{name:'increment',source:'agent',receivedAt:new Date().toISOString(),delayed:false,data:{}});await f.manager.disableOwner(w);
  await assert.rejects(f.manager.event(f.scope,{widgetId:w.widgetId,name:'increment'}),/widget_stopped/);
  await f.manager.update(f.scope,{widgetId:w.widgetId,state:{count:2}});await f.idle();assert.equal(f.store.get(w.widgetId).state.count,2);assert.equal(f.store.get(w.widgetId).pending,0);
});

test('shared recovery transport failure stops every sibling and never initializes a stale sibling',async t=>{
  const f=await widgetFixture(t);await f.withOneView();await f.manager.create(f.scope,{handler:'b.tsx',description:'Sibling'});
  const loaded=[];f.host.load=async w=>{loaded.push(w.widgetId);throw Object.assign(new Error('runtime unavailable'),{code:'sandbox_unavailable'});};
  await f.manager.recover();assert.equal(loaded.length,1);assert.ok(f.store.list(f.scope).every(w=>w.status==='stopped'));assert.equal(f.notices.filter(e=>e.eventType==='widget_runtime_failed').length,1);
});

test('recovery preserves durable view observations and does not republish',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId),view=f.store.getView(one.viewId);
  f.store.patchView(w,view.id,{message:{...view.message,reactions:{total:3}}});const before=f.telegramCalls.length;
  await f.manager.recover();assert.equal(f.store.getView(view.id).message.reactions.total,3);assert.equal(f.telegramCalls.length,before);
});

test('concurrent stopped updates serialize supplied state and keep the same view',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView();await f.manager.disableOwner(f.store.get(one.widgetId));
  await Promise.all([f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:1}}),f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:2}})]);
  assert.equal(f.store.get(one.widgetId).state.count,2);assert.equal(f.store.listViews(one.widgetId)[0].id,one.viewId);
});

test('retiring a caller during child build prevents child creation',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),caller=f.store.get(one.widgetId);let enter,finish;const entered=new Promise(r=>enter=r);
  // Build is routed through the host by production; the fixture replaces that boundary.
  const childManager=await import('../../src/widgets/manager.mjs');
  const manager=childManager.createWidgetManager({db:f.db,store:f.store,host:f.host,render:f.renderer,authorize:ref=>{if(ref.widgetId&&f.manager.isRevoked(ref))throw stoppedError();return f.scope;},build:async()=>{enter();await new Promise(r=>finish=r);return {snapshotId:'s'};}});
  const create=manager.create(f.scope,{handler:'child.tsx',description:'Child'},{callerRef:caller}),rejected=assert.rejects(create,/widget_stopped/);await entered;await f.manager.delete(f.scope,{widgetId:one.widgetId});finish();await rejected;assert.equal(f.store.list(f.scope).length,0);
});

test('failed view persistence reports IDs and keeps the previous binding available',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView();f.store.replaceView=()=>{throw Object.assign(new Error('disk unavailable'),{code:'storage_failed'});};
  await assert.rejects(f.manager.setView(f.scope,{widgetId:one.widgetId,target:one.target}),e=>e.code==='storage_failed'&&e.widgetId===one.widgetId&&Boolean(e.viewId));
  assert.equal(f.store.byTarget('b',one.target).id,one.viewId);assert.equal(f.store.getView(one.viewId).deliveryUnknown,true);
});

test('a failed projection does not kill healthy sibling widgets',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),sibling=await f.manager.create(f.scope,{handler:'b.tsx',description:'Sibling'});f.failNextEdit();
  await f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:1}});assert.equal(f.store.get(sibling.widgetId).status,'active');assert.equal(f.manager.isRevoked(f.store.get(sibling.widgetId)),false);
});

test('retiring a caller during child onCreate prevents activation and later publication',async t=>{
  let enter,finish;const entered=new Promise(r=>enter=r);let hold=false,caller;
  const f=await widgetFixture(t,{module:{async onCreate(){if(hold){enter();await new Promise(r=>finish=r);}}},managerOptions:{authorize:ref=>{if(ref.widgetId&&ref.widgetId===caller?.widgetId&&f.manager.isRevoked(ref))throw stoppedError();return f.scope;}}});
  const one=await f.withOneView();caller=f.store.get(one.widgetId);hold=true;
  const create=f.manager.create(f.scope,{handler:'b.tsx',description:'Child'},{callerRef:caller}),rejected=assert.rejects(create,/widget_stopped/);await entered;await f.manager.delete(f.scope,{widgetId:caller.widgetId});finish();await rejected;
  assert.equal(f.store.list(f.scope)[0].status,'stopped');assert.equal(f.telegramCalls.filter(c=>c.method==='sendMessage').length,1);
});
