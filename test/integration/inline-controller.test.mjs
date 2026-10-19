import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
async function fixture(t,{personal=true,avatars={},masterTelegramId}={}) {
  const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const agent=personal?db.ensureAgent('b',1):null,calls=[],batches=[];
  const c=createController({db,config:{masterTelegramId,inline:{triggerMs:0,waitMs:0,promptRows:2}},telegram:{call:async(botId,method,args)=>{calls.push({botId,method,args});return method==='getUserProfilePhotos'?(avatars[args.user_id]??{photos:[]}):true;}},agent:{run:async(scope,events)=>{batches.push({scope,events});}}});
  t.after(async()=>{c.close();await c.idle();db.close();});
  let id=0;const query=async offset=>{await c.receive('b',{inline_query:{id:String(++id),from:{id:1},query:'Wordle',offset:offset??'',chat_type:'group'}});await c.inline.service.idle();return calls.filter(call=>call.method==='answerInlineQuery').at(-1).args;};
  return {db,c,agent,calls,batches,query,scope:agent&&c.lifecycle.scope(agent)};
}
test('without an existing personal agent inline opens the bot and never creates an agent',async t=>{
  const f=await fixture(t,{personal:false}),answer=await f.query();assert.deepEqual(answer.results,[]);assert.equal(answer.button.start_parameter,'inline');assert.equal(f.db.agent('b',1),null);assert.equal(f.batches.length,0);
  assert.equal(f.calls.some(c=>c.method==='getUserProfilePhotos'),false);
});

test('controller uses child then master profile photos through the child token only',async t=>{
  for(const [avatars,expected,ids] of [[{42:{photos:[[{file_id:'own'}]]}},'own',[42]],[{99:{photos:[[{file_id:'master'}]]}},'master',[42,99]]]){
    const f=await fixture(t,{avatars,masterTelegramId:99}),answer=await f.query();
    assert.equal(answer.results[0].type,'photo');assert.equal(answer.results[0].photo_file_id,expected);
    assert.equal(answer.results[1].type,'article');assert.equal(answer.results.length,2);
    assert.deepEqual(f.calls.filter(c=>c.method==='getUserProfilePhotos').map(c=>[c.botId,c.args.user_id]),ids.map(id=>['b',id]));
    await f.query();assert.equal(f.calls.filter(c=>c.method==='getUserProfilePhotos').length,ids.length);
  }
});

test('ordinary read still rejects missing or malformed selectors after adding the inline alternative',async t=>{
  const f=await fixture(t);
  for(const args of [{},{messageIds:'7'},{messageIds:[null]}])await assert.rejects(f.c.invoke(f.scope,'read',args),{code:'invalid_argument'});
});
test('turn completion keeps waiting until explicit results and registers buttons only when delivered',async t=>{
  const f=await fixture(t),initial=await f.query(),working=await f.query(initial.next_offset);await f.c.queue.idle();
  const event=f.batches[0].events[0];assert.equal(event.eventType,'inline');assert.equal(event.chatType,'group');assert.equal('from'in event,false);assert.equal(f.c.inline.requests.get(event.requestId).phase,'waiting');
  const response=await f.c.invoke(f.scope,'set_inline_results',{requestId:event.requestId,results:[{title:'Ready',message:{text:'Wordle',buttons:[{text:'Start',action:'Activate Wordle',group:'start'}]}}]});assert.equal(response.status,'accepted');assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,0);
  const ready=await f.query(working.next_offset);assert.equal(ready.results[0].title,'Ready');assert.equal(ready.next_offset,'');assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,1);
  await f.c.receive('b',{callback_query:{id:'public-click',inline_message_id:'opaque',from:{id:2,first_name:'Public'},data:ready.results[0].reply_markup.inline_keyboard[0][0].callback_data}});await f.c.queue.idle();
  const clicked=f.batches.at(-1);assert.equal(clicked.scope.agentId,f.agent.agentId);assert.equal(clicked.events[0].from.userId,2);assert.equal(clicked.events[0].action,'Activate Wordle');
});
test('a new initial query cancels a pending inline job and rejects its late results without database writes',async t=>{
  const f=await fixture(t);f.c.queue.setPaused(f.agent.agentId,true);const initial=await f.query();await f.query(initial.next_offset);const old=f.c.inline.requests.current('b',1).requestId;assert.equal(f.c.queue.pending(f.agent.agentId),1);
  await f.query();assert.equal(f.c.queue.pending(f.agent.agentId),0);
  await assert.rejects(f.c.invoke(f.scope,'set_inline_results',{requestId:old,results:[{title:'Old',message:{text:'x',buttons:[{text:'x',action:'x'}]}}]}),{code:'request_unavailable'});assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,0);
});

test('incremental controller portions retain delayed button registration and replay consumed groups without resurrection',async t=>{
  const f=await fixture(t),initial=await f.query(),sent=await f.query(initial.next_offset);await f.c.queue.idle();
  const requestId=f.batches[0].events[0].requestId;
  await f.c.invoke(f.scope,'set_inline_results',{requestId,results:[{title:'Preparing',description:'A game'}],done:false});
  const status=await f.query(sent.next_offset);assert.equal(status.results[0].title,'⬇️ Preparing');assert.ok(status.next_offset);
  await f.c.invoke(f.scope,'set_inline_results',{requestId,results:[{title:'Wordle',message:{text:'Wordle',buttons:[{text:'Start',action:'Activate Wordle',group:'start'}]}}],done:false});
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,0);
  const card=await f.query(status.next_offset);assert.equal(card.results[0].title,'Wordle');assert.ok(card.next_offset);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,1);
  const data=card.results[0].reply_markup.inline_keyboard[0][0].callback_data;
  await f.c.receive('b',{callback_query:{id:'stream-click',inline_message_id:'stream-game',from:{id:2,first_name:'Player'},data}});await f.c.queue.idle();
  const replay=await f.query(status.next_offset);assert.deepEqual(replay.results,card.results);assert.equal(replay.next_offset,card.next_offset);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,0);
  await f.c.receive('b',{callback_query:{id:'stream-repeat',inline_message_id:'stream-game',from:{id:2,first_name:'Player'},data}});await f.c.queue.idle();
  assert.equal(f.batches.flatMap(b=>b.events).filter(e=>e.action==='Activate Wordle').length,1);
  await f.c.invoke(f.scope,'set_inline_results',{requestId,results:[],done:true});
  const end=await f.query(card.next_offset);assert.deepEqual(end.results,[]);assert.equal(end.next_offset,'');
});
