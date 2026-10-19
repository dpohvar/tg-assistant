import test from 'node:test';
import assert from 'node:assert/strict';
import {inlineFixture,tick} from '../helpers/inline-fixture.mjs';
test('prompt rows are selectable neutral messages without buttons',async t=>{
  const f=inlineFixture(t),a=await f.query();
  assert.equal(a.results.length,2);assert.equal(a.cache_time,0);assert.equal(a.is_personal,true);
  for(const r of a.results){assert.equal(r.input_message_content.message_text,'✖️');assert.equal(r.reply_markup,undefined);}
  assert.ok(a.next_offset);assert.equal(f.queued.length,0);
  assert.ok(a.results.every(r=>r.title==='⬇️ Scroll to send command [00:00:00]'));
  await f.clock.advance(1000);
  const next=await f.query({offset:a.next_offset});
  assert.ok(next.results.every(r=>r.title==='⬇️ Scroll to send command [00:00:01]'));
  assert.equal(a.results[0].title,'⬇️ Scroll to send command [00:00:00]');
  assert.equal(f.queued.length,0);
});

test('prompt pages follow 6,6,20 then repeat 20 and reset for a new inline request',async t=>{
  const f=inlineFixture(t,{policy:{promptRows:[6,6,20]}});let answer=await f.query();const sizes=[answer.results.length];
  for(let i=0;i<4;i++){await f.clock.advance(100);answer=await f.query({offset:answer.next_offset});sizes.push(answer.results.length);}
  assert.deepEqual(sizes,[6,6,20,20,20]);assert.equal(f.queued.length,0);
  const fresh=await f.query({query:'new'});assert.equal(fresh.results.length,6);
  assert.ok(f.answers.flatMap(a=>a.results).every(r=>r.title.startsWith('⬇️ ')));
});

test('only the first prompt row uses the system avatar and it still sends neutral text',async t=>{
  const lookups=[],f=inlineFixture(t,{policy:{promptRows:[6,6,20]},getPromptPhoto:async botId=>{lookups.push(botId);return 'own-avatar';}});
  const first=await f.query();assert.equal(first.results.length,6);
  assert.equal(first.results[0].type,'photo');assert.equal(first.results[0].photo_file_id,'own-avatar');
  assert.equal(first.results[0].title,'⬇️ Scroll to send command [00:00:00]');
  assert.deepEqual(first.results[0].input_message_content,{message_text:'✖️'});assert.equal(first.results[0].reply_markup,undefined);
  assert.ok(first.results.slice(1).every(r=>r.type==='article'));
  const next=await f.query({offset:first.next_offset});assert.equal(next.results.length,6);assert.ok(next.results.every(r=>r.type==='article'));assert.deepEqual(lookups,['b']);
  const fresh=await f.query({query:'fresh'});assert.equal(fresh.results[0].type,'photo');assert.deepEqual(lookups,['b','b']);
});

test('failed avatar lookup preserves the plain prompt and does not enqueue a command',async t=>{
  const f=inlineFixture(t,{getPromptPhoto:async()=>{throw new Error('Profile unavailable');}}),answer=await f.query();
  assert.ok(answer.results.every(r=>r.type==='article'));assert.equal(f.queued.length,0);
});

test('an old avatar lookup cannot publish a header into a replacement inline request',async t=>{
  let resolveOld,count=0;const old=new Promise(resolve=>{resolveOld=resolve;});
  const f=inlineFixture(t,{getPromptPhoto:()=>++count===1?old:'new-avatar'});
  await f.query({id:'old'});const fresh=await f.query({id:'fresh',query:'fresh'});
  assert.equal(fresh.results[0].photo_file_id,'new-avatar');resolveOld('old-avatar');await tick();
  assert.deepEqual(f.answers.find(a=>a.inline_query_id==='old').results,[]);
  assert.equal(f.requests.current('b',1).query,'fresh');
});
test('trigger compares each cursor issuance and submits only once',async t=>{
  const f=inlineFixture(t),first=await f.query();await f.clock.advance(1999);
  const fast=await f.query({offset:first.next_offset});assert.equal(f.queued.length,0);
  await f.clock.advance(2000);await f.query({offset:fast.next_offset});
  assert.equal(f.queued.length,1);assert.equal(f.queued[0].event.eventType,'inline');
  assert.equal(f.queued[0].event.from,undefined);assert.equal(f.queued[0].event.query,'wordle');
  const replay=await f.query({offset:first.next_offset});assert.equal(f.queued.length,1);
  assert.deepEqual(replay.results,fast.results);assert.equal(replay.next_offset,fast.next_offset);
});

test('submission is acknowledged immediately once, before delayed working pages',async t=>{
  const f=inlineFixture(t),first=await f.query();await f.clock.advance(2000);
  const sent=await f.query({offset:first.next_offset});assert.ok(sent,'submission must not wait for the working timer');
  assert.equal(sent.results[0].title,'⬇️ Command sent to agent');assert.equal(sent.results[0].input_message_content.message_text,'✖️');
  assert.equal(f.queued.length,1);const count=f.answers.length;
  await f.query({offset:sent.next_offset});await f.clock.advance(4999);assert.equal(f.answers.length,count);
  await f.clock.advance(1);assert.equal(f.answers.at(-1).results[0].title,'⬇️ Agent is working');assert.equal(f.queued.length,1);
});
test('explicit results wake a waiting page early and register only on issuance',async t=>{
  const f=inlineFixture(t),first=await f.query();await f.clock.advance(2000);
  const sent=await f.query({offset:first.next_offset});assert.equal(f.answers.length,2);
  await f.query({offset:sent.next_offset});
  await f.clock.advance(800);
  const requestId=f.queued[0].event.requestId;
  assert.deepEqual(f.service.setResults(f.scope,{requestId,results:[{title:'Ready',message:{text:'cat'}}]}),{status:'accepted'});
  await tick();assert.equal(f.answers.at(-1).results[0].title,'Ready');assert.equal(f.clock.now(),2800);
  assert.equal(f.registered.length,1);assert.equal(f.answers.at(-1).next_offset,'');
  await f.query({offset:first.next_offset});assert.deepEqual(f.answers.at(-1).results,sent.results);
  assert.equal(f.registered.length,1);
});
test('new initial removes previous queued work and never accepts its late result',async t=>{
  const f=inlineFixture(t),first=await f.query();await f.clock.advance(2000);await f.query({offset:first.next_offset});
  const old=f.queued[0],next=await f.query({query:'different'});
  assert.equal(old.admit(),false);assert.ok(f.cancelled.includes(old.event.requestId));
  assert.throws(()=>f.service.setResults(f.scope,{requestId:old.event.requestId,results:[{title:'Late'}]}),{code:'request_unavailable'});
  await f.query({offset:next.next_offset,userId:2});assert.deepEqual(f.answers.at(-1).results,[]);
  assert.equal(f.requests.current('b',1).query,'different');
});
test('first accepted empty list completes and repeated tool calls do not normalize again',async t=>{
  const f=inlineFixture(t);await f.query();const request=f.requests.current('b',1);
  assert.deepEqual(f.service.setResults(f.scope,{requestId:request.requestId,results:[]}),{status:'accepted'});
  assert.deepEqual(f.service.setResults(f.scope,{requestId:request.requestId,results:[{bad:true}]}),{status:'already_set'});
  assert.equal(f.normalizeCalls(),1);
  const cursor=f.requests.issueCursor(request.requestId);await f.query({offset:cursor});
  assert.equal(f.answers.at(-1).results[0].title,'Work complete');
  assert.equal(f.answers.at(-1).results[0].input_message_content.message_text,'✖️');
});
test('the common hour closes waiting work and releases all timers',async t=>{
  const f=inlineFixture(t),first=await f.query();await f.clock.advance(3599999);
  const sent=await f.query({offset:first.next_offset});await f.query({offset:sent.next_offset});await f.clock.advance(1);
  assert.deepEqual(f.answers.at(-1).results,[]);assert.equal(f.requests.current('b',1),null);
  assert.equal(f.clock.pending(),0);
});
test('registration failure closes request without sending the final page',async t=>{
  const f=inlineFixture(t),first=await f.query(),r=f.requests.current('b',1);
  f.service.setResults(f.scope,{requestId:r.requestId,results:[{title:'Ready'}]});
  f.failRegistration(new Error('db failed'));await f.query({offset:first.next_offset});
  assert.equal(f.requests.current('b',1),null);assert.equal(f.answers.length,1);
  assert.throws(()=>f.service.setResults(f.scope,{requestId:r.requestId,results:[]}),{code:'request_unavailable'});
});
test('an answer error on an old version never closes its replacement',async t=>{
  let reject;
  const f=inlineFixture(t,{answer:body=>body.inline_query_id==='old'?new Promise((_,r)=>{reject=r;}):undefined});
  await f.query({id:'old'});await f.query({id:'new',query:'new'});
  reject(new Error('old answer failed'));await tick();
  assert.equal(f.requests.current('b',1).query,'new');
});
test('duplicate initial query ID is not a new version or another answer attempt',async t=>{
  const f=inlineFixture(t);await f.query({id:'same'});const r=f.requests.current('b',1);
  await f.query({id:'same'});assert.equal(f.requests.current('b',1),r);assert.equal(f.answers.length,1);
});
test('ready pages respect the Telegram page bound without a total result limit',async t=>{
  const f=inlineFixture(t),first=await f.query(),r=f.requests.current('b',1);
  f.service.setResults(f.scope,{requestId:r.requestId,results:Array.from({length:101},(_,i)=>({title:String(i),id:String(i)}))});
  let a=await f.query({offset:first.next_offset});assert.equal(a.results.length,50);
  a=await f.query({offset:a.next_offset});assert.equal(a.results.length,50);
  a=await f.query({offset:a.next_offset});assert.equal(a.results.length,1);assert.equal(a.next_offset,'');
});

test('photos start a separate final page and register only when that page is requested',async t=>{
  const f=inlineFixture(t);
  for(const [otherCount,photoCount,sizes] of [[3,1,[3,1]],[3,3,[3,3]],[49,2,[49,2]],[50,2,[50,2]],[51,51,[50,1,50,1]],[0,51,[50,1]]]){
    const first=await f.query(),r=f.requests.current('b',1),before=f.registered.length;
    const prepared=Array.from({length:otherCount+photoCount},(_,i)=>({native:{id:String(i),type:i<otherCount?'article':'photo'},definitions:[{btnId:'button-'+i}]}));
    f.requests.setReady(f.scope,r.requestId,prepared);assert.equal(f.registered.length,before);
    let cursor=first.next_offset,position=0,pageNumber=0;
    for(const size of sizes){
      const page=await f.query({offset:cursor});assert.equal(page.results.length,size);
      assert.equal(new Set(page.results.map(x=>x.type)).size,1,'photo and other results must not share a page');
      const registered=f.registered.at(-1);assert.deepEqual(registered,prepared.slice(position,position+size));
      position+=size;cursor=page.next_offset;
      assert.equal(Boolean(cursor),position<prepared.length);
      assert.equal(r.phase,cursor?'ready':'delivered');
      assert.equal(f.registered.length,before+(++pageNumber));
    }
    assert.equal(position,prepared.length);assert.equal(f.registered.length,before+sizes.length);
  }
});
test('disabled owner closes requests, wakes pages and does not consume ready results',async t=>{
  const f=inlineFixture(t),first=await f.query();await f.clock.advance(2000);await f.query({offset:first.next_offset});
  await f.query({offset:f.answers.at(-1).next_offset});
  f.service.disableOwner('b','a','disabled');await tick();
  assert.deepEqual(f.answers.at(-1).results,[]);assert.equal(f.requests.current('b',1),null);
});
