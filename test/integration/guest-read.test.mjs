import test from 'node:test';
import assert from 'node:assert/strict';
import {guestFixture,guestMessage} from '../helpers/guest-fixture.mjs';
import {createController} from '../../src/controller.mjs';
test('controller guest reads are isolated and all three address modes reject combinations',async t=>{
  const f=guestFixture(t);await f.receive();const id=f.batches[0].events[0].guestRequestId;
  assert.equal((await f.c.invoke(f.scope,'read',{guestRequestId:id})).messages[0].guest_query_id,'query');
  assert.equal((await f.c.invoke(f.scope,'read',{messageIds:[7]})).messages[0].error,'message_not_found');
  for(const args of [{guestRequestId:id,messageIds:[7]},{guestRequestId:id,inlineMessageId:'inline'},{guestRequestId:id,chatId:1},{inlineMessageId:'inline',messageIds:[7]},{}])await assert.rejects(f.c.invoke(f.scope,'read',args),{code:'invalid_argument'});
  f.db.saveChat('b',{id:2,type:'private'});f.db.setRole('b',2,'user');const other=f.c.lifecycle.scope(f.db.ensureAgent('b',2));
  await assert.rejects(f.c.invoke(other,'read',{guestRequestId:id}),{code:'guest_request_unavailable'});
});
test('retained guest handles survive context clear and controller restart without model replay',async t=>{
  const f=guestFixture(t);await f.receive();const id=f.batches[0].events[0].guestRequestId;
  await f.c.receive('b',{message:{message_id:20,date:1,from:{id:1},chat:{id:1,type:'private'},text:'/agent clear'}});await f.c.idle();
  const fresh=f.c.lifecycle.scope(f.db.agent('b',1));assert.equal((await f.c.invoke(fresh,'read',{guestRequestId:id})).messages[0].text,'@bot hello');
  f.c.close();await f.c.idle();const calls=[],batches=[];
  const c=createController({db:f.db,telegram:{call:async(_bot,method,args)=>{calls.push({method,args});return {inline_message_id:'after-restart'};}},agent:{run:async(_scope,events)=>batches.push(events)}});
  try{await c.ready;assert.deepEqual(batches,[]);assert.deepEqual(calls,[]);const scope=c.lifecycle.scope(f.db.agent('b',1));
    assert.equal((await c.invoke(scope,'read',{guestRequestId:id})).messages[0].text,'@bot hello');
    assert.deepEqual(await c.invoke(scope,'send',{guestRequestId:id,text:'Delayed answer'}),{inlineMessageId:'after-restart'});assert.equal(calls.length,1);
  }finally{c.close();await c.idle();}
});
test('native session preflight drops unavailable or expired guest events without affecting unrelated input',async t=>{
  let time=1000;const f=guestFixture(t,{clock:()=>time});await f.receive();const event=f.batches[0].events[0],ordinary={eventType:'message',messageId:9};
  f.db.sql.prepare('UPDATE chats SET agentEnabled=0 WHERE chatId=1').run();assert.deepEqual(f.agent.filterEvents(f.scope,[event,ordinary]),[ordinary]);
  f.db.sql.prepare('UPDATE chats SET agentEnabled=1 WHERE chatId=1').run();time+=30*86400000;assert.deepEqual(f.agent.filterEvents(f.scope,[event]),[]);
  assert.equal((await f.c.invoke(f.scope,'send',{guestRequestId:event.guestRequestId,text:'Late'})).error,'guest_request_unavailable');assert.equal(f.calls.length,0);
});
test('a guest answer registers action buttons before publication and holds an early callback until registration',async t=>{
  let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  const f=guestFixture(t,{telegram:async(_bot,method)=>{if(method==='answerGuestQuery'){enter();await gate;return {inline_message_id:'early'};}return true;}});
  await f.receive();const id=f.batches[0].events[0].guestRequestId;
  const sending=f.c.invoke(f.scope,'send',{guestRequestId:id,text:'Start',buttons:[{text:'Start',action:'Activate widget'}]});await entered;
  const native=f.calls.find(x=>x.method==='answerGuestQuery').args.result;
  const receiving=f.c.receive('b',{callback_query:{id:'early-click',inline_message_id:'early',data:native.reply_markup.inline_keyboard[0][0].callback_data,from:{id:2,first_name:'Public'}}});
  await new Promise(r=>setImmediate(r));assert.ok(f.calls.some(x=>x.method==='answerCallbackQuery'));assert.equal(f.batches.length,1);
  release();await sending;await receiving;await f.c.queue.idle();assert.equal(f.batches.length,2);assert.equal(f.batches[1].events[0].action,'Activate widget');assert.equal(f.batches[1].scope.agentId,f.owner.agentId);
});
test('a later inline request never cancels an independently queued guest invocation',async t=>{
  const f=guestFixture(t);f.c.queue.setPaused(f.owner.agentId,true);
  await f.c.receive('b',{update_id:1,guest_message:guestMessage()});
  await f.c.receive('b',{inline_query:{id:'inline',from:{id:1},query:'new inline',offset:''}});await f.c.inline.service.idle();
  assert.equal(f.c.queue.pending(f.owner.agentId),1);f.c.queue.setPaused(f.owner.agentId,false);await f.c.queue.idle();assert.equal(f.batches[0].events[0].eventType,'guest_message');
});
