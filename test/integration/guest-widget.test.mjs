import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';
import {createGuestStore} from '../../src/guest/store.mjs';
import {createGuestReceipts} from '../../src/guest/receipts.mjs';
import {createGuestService} from '../../src/guest/service.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {guestMessage} from '../helpers/guest-fixture.mjs';
async function fixture(t,options={}) {
  let guest,request,inlineStore;
  const f=await widgetFixture(t,{...options,guestFactory:({db,scope,telegram})=>{
    const store=createGuestStore(db);inlineStore=createInlineStore(db);
    request=store.record({botId:'b',agentId:scope.agentId,callerUserId:1,updateId:1,message:guestMessage()}).request;
    guest=createGuestService({store,inlineStore,telegram,db,access:createAccess(db),assertCurrent:()=>{},resolveActor:()=>scope,receipts:createGuestReceipts()});return guest;
  }});
  return {...f,get guest(){return guest;},get request(){return request;},get inlineStore(){return inlineStore;}};
}
test('first guest widget publication is the complete render with native callbacks and no placeholder',async t=>{
  const snapshots=[],f=await fixture(t,{module:{render(state,view){snapshots.push(view);assert.ok(Object.isFrozen(view.target));assert.ok(Object.isFrozen(view.props));return {text:'Wordle',reply_markup:{inline_keyboard:[[{text:'Start',callback_data:'increment'}]]}};}}});
  const w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Game'});
  const view=await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:f.request.guestRequestId},props:{part:'game'}});
  assert.deepEqual(snapshots[0].target,{guestRequestId:f.request.guestRequestId});assert.ok(view.target.inlineMessageId);
  const sends=f.telegramCalls.filter(x=>x.method!=='answerCallbackQuery');assert.equal(sends.length,1);assert.equal(sends[0].method,'answerGuestQuery');assert.equal(sends[0].args.result.input_message_content.message_text,'Wordle');assert.equal(sends[0].args.result.reply_markup.inline_keyboard[0][0].callback_data,'increment');
  assert.equal(f.inlineStore.owner('b',view.target.inlineMessageId).agentId,f.scope.agentId);assert.equal(f.guest.hasPending('b'),false);
  await f.receiveButton(view.target);await f.idle();assert.equal(f.store.get(w.widgetId).state.count,1);
  assert.deepEqual(snapshots.at(-1).target,view.target);
});
test('each Telegram-accepted guest widget publication becomes its own synchronized view',async t=>{
  const f=await fixture(t),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Game'});
  const views=await Promise.all([1,2].map(i=>f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:f.request.guestRequestId},props:{part:String(i)}})));
  assert.notEqual(views[0].viewId,views[1].viewId);assert.notEqual(views[0].target.inlineMessageId,views[1].target.inlineMessageId);
  await f.receiveButton(views[0].target);await f.idle();assert.equal(f.store.listViews(w.widgetId).length,2);
  assert.deepEqual(f.store.listViews(w.widgetId).map(v=>v.message.text).sort(),['1:1','2:1']);
});
test('guest widget initial render and incompatible envelope failures publish nothing',async t=>{
  let renderError=false;const f=await fixture(t,{module:{render(){if(renderError)throw new Error('Render failed');return {text:'Ready'};}}}),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Game'});
  for(const send of [{guestRequestId:f.request.guestRequestId,chatId:1},{guestRequestId:f.request.guestRequestId,disable_notification:true},{guestRequestId:''}])await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send}),{code:'invalid_argument'});
  renderError=true;await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:f.request.guestRequestId}}));assert.equal(f.telegramCalls.length,0);
});
test('a failed guest view commit retains the confirmed inline target as a publication candidate',async t=>{
  const f=await fixture(t),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Game'}),create=f.store.createView;
  f.store.createView=()=>{throw new Error('Database unavailable');};
  await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:f.request.guestRequestId}}),error=>error.code==='storage_failed'&&Boolean(error.confirmedTarget.inlineMessageId));
  f.store.createView=create;
  const candidates=f.store.listCandidates(w.widgetId);assert.equal(candidates.length,1);assert.ok(candidates[0].target.inlineMessageId);assert.equal(f.guest.hasPending('b'),false);
  assert.equal(f.store.listViews(w.widgetId).length,0);assert.equal(f.telegramCalls.filter(x=>x.method==='answerGuestQuery').length,1);
});
test('unsupported guest widget content fails before publication without touching local media files',async t=>{
  for(const output of [{poll:{question:'No',options:[{text:'A'},{text:'B'}]}},{photo:'file:missing.png'}]){
    const f=await fixture(t,{module:{render(){return output;}}}),w=await f.manager.create(f.scope,{handler:'counter.tsx',description:'Unsupported'});
    await assert.rejects(f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:f.request.guestRequestId}}));assert.equal(f.telegramCalls.length,0);
  }
});
