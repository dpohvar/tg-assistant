import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWordleFixture} from '../helpers/wordle-fixture.mjs';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';
import {createGuestStore} from '../../src/guest/store.mjs';
import {createGuestReceipts} from '../../src/guest/receipts.mjs';
import {createGuestService} from '../../src/guest/service.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {guestMessage} from '../helpers/guest-fixture.mjs';
test('unchanged archived Wordle publishes its first guest render and handles native buttons',{skip:!process.env.TG_WORDLE_ARCHIVE},async t=>{
  const wordle=await loadWordleFixture(t,process.env.TG_WORDLE_ARCHIVE);let request;
  const f=await widgetFixture(t,{module:wordle.module,api:async(name,args)=>{
    if(name==='user_roles')return {users:args.userIds.map(userId=>({userId,role:userId===1?'owner':null}))};
    if(name==='notify_agent')return {};throw new Error('Unexpected Wordle tool '+name);
  },guestFactory:({db,scope,telegram})=>{
    const store=createGuestStore(db);request=store.record({botId:'b',agentId:scope.agentId,callerUserId:1,updateId:1,message:guestMessage()}).request;
    return createGuestService({store,inlineStore:createInlineStore(db),telegram,db,access:createAccess(db),assertCurrent:()=>{},resolveActor:()=>scope,receipts:createGuestReceipts()});
  }});
  const w=await f.manager.create(f.scope,{handler:'widgets/wordle/widget.tsx',description:'Unchanged Wordle',state:{notify:false,inactivityMs:60000}});
  const view=await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{guestRequestId:request.guestRequestId}});
  assert.equal(f.telegramCalls.filter(x=>x.method==='answerGuestQuery').length,1);assert.equal(f.telegramCalls.some(x=>x.method==='sendMessage'),false);
  await f.receiveButton(view.target,'menu:start');await f.idle();assert.equal(f.store.get(w.widgetId).state.mode,'game');
  await f.receiveButton(view.target,'key:А');await f.idle();assert.equal(f.store.get(w.widgetId).state.players['1'].input,'А');
  assert.ok(f.telegramCalls.some(x=>x.args.inline_message_id===view.target.inlineMessageId));assert.deepEqual(wordle.sourceHashesAfter(),wordle.sourceHashesBefore);
});
