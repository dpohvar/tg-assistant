import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';

test('view replacement waits for ctx.render started outside the event queue',async t=>{
  let ctx;const f=await widgetFixture(t,{module:{onInit(c){ctx=c;}}}),one=await f.withOneView();
  const gate=f.blockNextPublish();ctx.state.count=1;const rendering=ctx.render();await gate.entered;
  let replaced=false;const replacement=f.manager.setView(f.scope,{widgetId:one.widgetId,target:one.target,props:{part:'new'}}).then(()=>replaced=true);
  await new Promise(r=>setImmediate(r));assert.equal(replaced,false);
  gate.release();await rendering;await replacement;assert.equal(replaced,true);
});

test('owner stop during an in-flight replacement prevents binding commit and disables the late edit',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView(),gate=f.blockNextPublish();
  const replacing=f.manager.setView(f.scope,{widgetId:one.widgetId,target:one.target,props:{part:'new'}});replacing.catch(()=>{});
  await gate.entered;await f.manager.disableOwner(f.scope);gate.release();
  await assert.rejects(replacing,{code:'widget_stopped'});
  assert.equal(f.store.byTarget('b',one.target).id,one.viewId);
  const last=f.telegramCalls.filter(c=>c.method.startsWith('edit')).at(-1);
  assert.ok(last.args.reply_markup.inline_keyboard[0][0].disabled);
});

test('a widget starts without views and shares state across independent ordinary and inline views',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Counter',state:{count:2}});
  assert.deepEqual(f.store.listViews(w.widgetId),[]);assert.equal(f.telegramCalls.length,0);
  const one=await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{},props:{part:'words'}});
  const two=await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{chatId:-100123},props:{part:'keyboard'}});
  const inline=await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'opaque-id'},props:{part:'inline'}});
  assert.equal(f.store.listViews(w.widgetId).length,3);
  await f.manager.update(f.scope,{widgetId:w.widgetId,state:{count:3}});
  assert.equal(f.store.get(w.widgetId).state.count,3);
  for(const [v,part]of [[one,'words'],[two,'keyboard'],[inline,'inline']])assert.equal(f.store.getView(v.viewId).renderSpec.text,`${part}:3`);
  const calls=f.telegramCalls.filter(c=>c.args.inline_message_id);
  assert.ok(calls.length);assert.ok(calls.every(c=>!('chat_id'in c.args)&&!('message_id'in c.args)));
});

test('view parameters and target are frozen copies, including before first send',async t=>{
  const snapshots=[],f=await widgetFixture(t,{module:{render(state,view){snapshots.push(view);assert.ok(Object.isFrozen(view));assert.ok(Object.isFrozen(view.props.nested));assert.ok(Object.isFrozen(view.target));assert.throws(()=>view.props.nested.a=2,TypeError);state.count=7;return {text:'frozen'};}}});
  const w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Frozen'}),props={nested:{a:1}};
  await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{},props});
  assert.deepEqual(snapshots[0].target,{chatId:1});assert.equal(props.nested.a,1);
});

test('invalid send envelopes fail before rendering or Telegram effects',async t=>{
  const f=await widgetFixture(t),w=await f.manager.create(f.scope,{handler:'a.tsx',description:'Validation'});
  for(const send of [[],null,{chatId:0},{chatId:'1'},{topicId:-1},{disable_notification:'yes'},{reply_parameters:[]}])
    await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send}),{code:'invalid_argument'});
  assert.equal(f.telegramCalls.length,0);
});

test('replacing a view changes its ID and keeps the shared widget and continuous binding',async t=>{
  const f=await widgetFixture(t),{widgetId,viewId,target}=await f.withOneView(),old=f.store.getView(viewId);
  const next=await f.manager.setView(f.scope,{widgetId,target,props:{part:'results'}});
  assert.notEqual(next.viewId,viewId);assert.equal(f.store.getView(viewId),null);
  assert.equal(f.store.getView(next.viewId).bindingEpoch,old.bindingEpoch);
  assert.equal(f.store.listViews(widgetId).length,1);
});

test('replacement waits for an in-flight publication and retains the old view after failure',async t=>{
  const f=await widgetFixture(t),{widgetId,viewId,target}=await f.withOneView();
  const block=f.blockNextPublish(),repaint=f.manager.update(f.scope,{widgetId,state:{count:1}});
  await block.entered;
  const replacing=f.manager.setView(f.scope,{widgetId,target,props:{part:'results'}});
  assert.equal(f.store.byTarget('b',target).id,viewId);
  f.failNextEdit();block.release();await repaint;
  f.failNextEdit();await assert.rejects(replacing);
  assert.equal(f.store.byTarget('b',target).id,viewId);
});

test('another widget cannot take a message and conflicts include agent, widget and view IDs',async t=>{
  const f=await widgetFixture(t),first=await f.withOneView(),other=await f.manager.create(f.scope,{handler:'a.tsx',description:'Other'});
  const attempt=f.manager.setView(f.scope,{widgetId:other.widgetId,target:first.target});
  const blocked=f.manager.buttonsBlocked(first.viewId);
  await assert.rejects(attempt,e=>e.code==='view_conflict'&&e.ownerAgentId===f.scope.agentId&&e.widgetId===first.widgetId&&e.viewId===first.viewId);
  assert.equal(blocked,false,'a conflicting request must not block the existing view buttons');
});

test('a failed view does not roll back state or block rendering other views',async t=>{
  const f=await widgetFixture(t),first=await f.withOneView(),second=await f.manager.setView(f.scope,{widgetId:first.widgetId,send:{chatId:-100123}});
  f.failNextEdit();await f.manager.update(f.scope,{widgetId:first.widgetId,state:{count:5}});
  assert.equal(f.store.get(first.widgetId).state.count,5);
  assert.equal(f.store.getView(second.viewId).renderSpec.text,'game:5');
  assert.ok(f.store.getView(first.viewId).lastError);assert.equal(f.store.get(first.widgetId).status,'active');
});
