import test from 'node:test';
import assert from 'node:assert/strict';
import {guestServiceFixture} from '../helpers/guest-service-fixture.mjs';
test('guest send publishes natively and immediately registers independent owner snapshots',async t=>{
  const f=guestServiceFixture(t),result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Hello',buttons:[{text:'Start',action:'Start Wordle'}]});
  assert.deepEqual(result,{inlineMessageId:'inline-1'});assert.deepEqual(f.calls.map(x=>x.method),['answerGuestQuery']);
  assert.equal(f.calls[0].args.guest_query_id,'query');assert.equal(f.inlineStore.owner('b','inline-1').agentId,f.scope.agentId);
  assert.equal(f.inlineStore.read(f.scope,'inline-1').text,'Hello');assert.equal(f.inlineStore.read(f.scope,'inline-1').snapshotComplete,true);
  assert.equal(f.receipts.list().length,0);assert.equal(f.store.publications(f.scope,f.req.guestRequestId)[0].status,'confirmed');
});
test('concurrent guest answers both reach Telegram and retain both successful messages',async t=>{
  let release;const gate=new Promise(r=>release=r);let started=0;
  const f=guestServiceFixture(t,{effect:async()=>{const id=++started;if(started===2)release();await gate;return {inline_message_id:'concurrent-'+id};}});
  const results=await Promise.all(['One','Two'].map(text=>f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text})));
  assert.deepEqual(new Set(results.map(x=>x.inlineMessageId)),new Set(['concurrent-1','concurrent-2']));assert.equal(started,2);
  assert.equal(f.store.publications(f.scope,f.req.guestRequestId).filter(x=>x.status==='confirmed').length,2);
  assert.equal(f.inlineStore.read(f.scope,'concurrent-1').text,'One');assert.equal(f.inlineStore.read(f.scope,'concurrent-2').text,'Two');
});
test('Telegram repeat rejection remains explicit with original description and prior confirmation evidence',async t=>{
  let calls=0;const f=guestServiceFixture(t,{effect:async()=>{if(++calls===1)return {inline_message_id:'first'};throw Object.assign(new Error('query is invalid or expired'),{code:'telegram_api_error'});}});
  assert.equal((await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'One'})).inlineMessageId,'first');
  const failure=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Two'});
  assert.equal(calls,2);assert.equal(failure.error,'telegram_api_error');assert.match(failure.description,/query is invalid or expired/);assert.deepEqual(failure.previousInlineMessageIds,['first']);
});
test('invalid guest envelopes and preparation failures cause no Telegram call or private fallback',async t=>{
  const f=guestServiceFixture(t);
  for(const extra of [{chatId:1},{topicId:1},{reply_parameters:{message_id:1}},{uploads:{}},{photo:'x'},{origin:'widget'}]){
    const result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Hello',...extra});assert.ok(result.error);
  }
  assert.equal(f.calls.length,0);
  assert.equal((await f.service.send({...f.scope,agentId:'other'},{guestRequestId:f.req.guestRequestId,text:'Hi'})).error,'guest_request_unavailable');
});
test('guest full reads preserve native context but reject mixed addresses and foreign ownership',t=>{
  const f=guestServiceFixture(t),read=f.service.read(f.scope,{guestRequestId:f.req.guestRequestId});
  assert.equal(read.messages[0].text,'@bot hello');assert.equal(read.messages[0].date,'1970-01-01T00:00:01.000Z');
  assert.throws(()=>f.service.read(f.scope,{guestRequestId:f.req.guestRequestId,messageIds:[7]}),{code:'invalid_argument'});
  assert.throws(()=>f.service.read({...f.scope,agentId:'other'},{guestRequestId:f.req.guestRequestId}),{code:'guest_request_unavailable'});
});
test('confirmed media snapshots are complete authored content without an invented native Message',async t=>{
  const f=guestServiceFixture(t),result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,location:{latitude:1,longitude:2}});
  const saved=f.inlineStore.read(f.scope,result.inlineMessageId);assert.deepEqual(saved.location,{latitude:1,longitude:2});assert.equal(saved.snapshotComplete,true);assert.equal(saved.message_id,undefined);
});
