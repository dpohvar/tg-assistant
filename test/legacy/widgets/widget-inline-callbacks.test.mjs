import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';
import {createWidgetEvents} from '../../src/widgets/events.mjs';
import {buttons} from '../../src/messages/callbacks.mjs';
import {jsx,Fragment} from '../../src/widgets/jsx-runtime.mjs';
import {createGuestStore} from '../../src/guest/store.mjs';
import {createGuestReceipts} from '../../src/guest/receipts.mjs';
import {createGuestService} from '../../src/guest/service.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {guestMessage} from '../helpers/guest-fixture.mjs';
import {guestAcceptanceGuard} from '../manual/guest-acceptance.mjs';
import {createController} from '../../src/controller.mjs';

async function inlineFixture(t,options={}){
  const f=await widgetFixture(t,options),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Public counter'});
  const v=await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'publisher-address'}});
  const wire=()=>f.telegramCalls.filter(c=>c.args.inline_message_id==='publisher-address'&&c.args.reply_markup).at(-1).args.reply_markup.inline_keyboard[0][0].callback_data;
  const receive=createWidgetEvents({db:f.db,manager:f.manager,telegram:f.telegram});
  const click=(data=wire(),inlineMessageId='recipient-address',botId='b',message)=>receive(botId,{callback_query:{id:'callback',from:{id:2},inline_message_id:inlineMessageId,data,...(message?{message}:{})}});
  return {...f,w,v,wire,click};
}

test('inline widget dispatch uses the published view when another private participant has a different inline ID',async t=>{
  const f=await inlineFixture(t);
  await f.click();await f.idle();
  assert.equal(f.store.get(f.w.widgetId).state.count,1);
  assert.equal(f.handled[0].data.data,'increment');assert.equal(f.handled[0].data.inline_message_id,'recipient-address');
  assert.equal(f.handled[0].user.id,2);assert.deepEqual(f.handled[0].view.target,{inlineMessageId:'publisher-address'});
  assert.ok(f.telegramCalls.filter(c=>c.method.startsWith('edit')).every(c=>c.args.inline_message_id==='publisher-address'));
  assert.equal(f.store.byTarget('b',{inlineMessageId:'recipient-address'}),null);
});

test('inline callback tokens never cross bots, ordinary routes or another bound view',async t=>{
  const f=await inlineFixture(t),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Other'});
  await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'other-bound-address'}});
  await f.click(f.wire(),'recipient-address','foreign-bot');
  await f.click(f.wire(),'other-bound-address');
  await f.click(f.wire(),'recipient-address','b',{message_id:99,chat:{id:1}});
  await f.click(f.wire().slice(0,-1)+'!');await f.idle();
  assert.equal(f.handled.length,0);assert.equal(f.store.get(f.w.widgetId).sequence,0);
});

test('retired views and removed callbacks cannot dispatch their previously published tokens',async t=>{
  const f=await inlineFixture(t),old=f.wire();
  await f.manager.setView(f.scope,{widgetId:f.w.widgetId,target:f.v.target});
  await f.click(old);await f.idle();assert.equal(f.handled.length,0);
  const removed=f.wire();f.module.render=()=>({text:'Closed'});await f.manager.update(f.scope,{widgetId:f.w.widgetId});
  await f.click(removed);await f.idle();assert.equal(f.handled.length,0);
});

test('inline wire tokens fit Telegram limits while handlers retain full UTF-8 callback payloads',async t=>{
  const local='increment:'+'я'.repeat(27),f=await inlineFixture(t,{module:{render:()=>({text:'Full',reply_markup:{inline_keyboard:[[{text:'Go',callback_data:local}]]}})}});
  assert.equal(Buffer.byteLength(local),64);assert.ok(Buffer.byteLength(f.wire())<=64);
  await f.click();await f.idle();assert.equal(f.handled[0].data.data,local);
});

test('inline decorative void tokens acknowledge without admitting events',async t=>{
  const f=await inlineFixture(t,{module:{render:()=>({text:'Decoration',reply_markup:{inline_keyboard:[[{text:'Label',callback_data:'void'}]]}})}});
  await f.click();await f.idle();assert.equal(f.store.get(f.w.widgetId).sequence,0);
  assert.ok(f.telegramCalls.some(c=>c.method==='answerCallbackQuery'));
});

test('nested rich inline buttons retain authored action payloads on participant-specific addresses',async t=>{
  const f=await inlineFixture(t);
  f.module.render=()=>jsx(Fragment,{children:jsx('p',{children:jsx('tg-button',{type:'callback_data',data:'increment:rich',children:'+'})})});
  await f.manager.update(f.scope,{widgetId:f.w.widgetId});
  const value=f.telegramCalls.filter(c=>c.args.rich_message).at(-1).args.rich_message;
  await f.click(buttons(value)[0].callback_data);await f.idle();
  assert.equal(f.handled[0].data.data,'increment:rich');assert.equal(f.store.get(f.w.widgetId).state.count,1);
});

test('stopped and uncertain inline views reject even a valid published token',async t=>{
  const f=await inlineFixture(t),wire=f.wire();
  f.store.patchView(f.store.get(f.w.widgetId),f.v.viewId,{deliveryUnknown:true});await f.click(wire);await f.idle();assert.equal(f.handled.length,0);
  f.store.patchView(f.store.get(f.w.widgetId),f.v.viewId,{deliveryUnknown:false});await f.manager.disableOwner(f.scope);
  await f.click(wire);await f.idle();assert.equal(f.handled.length,0);
});

test('initial guest publication routes the second participant without claiming their different inline address',async t=>{
  let request,inlineStore;
  const f=await widgetFixture(t,{guestFactory:({db,scope,telegram})=>{
    const store=createGuestStore(db);inlineStore=createInlineStore(db);
    request=store.record({botId:'b',agentId:scope.agentId,callerUserId:1,updateId:1,message:guestMessage()}).request;
    return createGuestService({store,inlineStore,telegram,db,access:createAccess(db),assertCurrent:()=>{},resolveActor:()=>scope,receipts:createGuestReceipts()});
  }});
  const w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Guest counter'});
  const view=await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:request.guestRequestId}});
  const sent=f.telegramCalls.find(c=>c.method==='answerGuestQuery'),wire=sent.args.result.reply_markup.inline_keyboard[0][0].callback_data;
  const update={callback_query:{id:'guest-second-player',from:{id:2},inline_message_id:'other-participant-address',data:wire}};
  const guard=guestAcceptanceGuard({botId:'b',ownerId:1,run:'test',widgetStore:()=>f.store});assert.equal(guard.accept(update),true);
  const receive=createWidgetEvents({db:f.db,manager:f.manager,telegram:f.telegram});await receive('b',update);await f.idle();
  assert.equal(f.store.get(w.widgetId).state.count,1);assert.deepEqual(f.handled[0].view.target,view.target);
  assert.equal(inlineStore.owner('b','other-participant-address'),null);
  assert.ok(f.telegramCalls.filter(c=>c.method.startsWith('edit')).every(c=>c.args.inline_message_id===view.target.inlineMessageId));
});

test('the complete controller admits a participant-specific inline callback without bot roles or alias ownership',async t=>{
  const f=await widgetFixture(t),c=createController({db:f.db,widgetService:f.manager,telegram:f.telegram,agent:{run:async()=>assert.fail('Widget callback must not invoke model')}});
  try{
    await c.ready;const w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Controller counter'});
    await f.manager.setView(f.scope,{widgetId:w.widgetId,target:{inlineMessageId:'canonical-controller'}});
    const wire=f.telegramCalls.filter(x=>x.args.inline_message_id==='canonical-controller').at(-1).args.reply_markup.inline_keyboard[0][0].callback_data;
    await c.receive('b',{callback_query:{id:'recipient-controller',from:{id:2},inline_message_id:'recipient-controller',chat_instance:'private-dialog',data:wire}});await f.idle();
    assert.equal(f.store.get(w.widgetId).state.count,1);assert.equal(f.db.role('b',2),null);
    assert.equal(c.inline.store.owner('b','recipient-controller'),null);
    assert.equal(f.handled[0].data.data,'increment');
  }finally{c.close();await c.idle();}
});

test('a token published before a failed binding commit cannot resolve an unregistered candidate view',async t=>{
  const f=await inlineFixture(t),create=f.store.createView;
  f.store.createView=()=>{throw new Error('Fixture database failure');};
  try{await assert.rejects(f.manager.setView(f.scope,{widgetId:f.w.widgetId,target:{inlineMessageId:'failed-publication'}}),{code:'storage_failed'});}
  finally{f.store.createView=create;}
  const wire=f.telegramCalls.filter(c=>c.args.inline_message_id==='failed-publication'&&c.args.reply_markup).at(-1).args.reply_markup.inline_keyboard[0][0].callback_data;
  await f.click(wire);await f.idle();assert.equal(f.handled.length,0);assert.equal(f.store.get(f.w.widgetId).sequence,0);
});
