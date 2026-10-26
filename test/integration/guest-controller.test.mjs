import test from 'node:test';
import assert from 'node:assert/strict';
import {guestFixture,guestMessage} from '../helpers/guest-fixture.mjs';
import {poll} from '../../src/telegram/polling.mjs';

test("guest mention selects its author's existing agent and saves the full message before dispatch",async t=>{
  const f=guestFixture(t);await f.receive();
  assert.equal(f.batches.length,1);assert.equal(f.batches[0].scope.agentId,f.owner.agentId);
  const event=f.batches[0].events[0];assert.equal(event.eventType,'guest_message');assert.ok(event.guestRequestId);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM guest_requests').get().n,1);
  assert.equal(f.db.getChat('b',-50),null);assert.equal(f.db.getMessage('b',1,7),null);assert.deepEqual(f.calls.map(c=>({method:c.method,...c.args})),[{method:'sendChatAction',chat_id:1,action:'typing'}]);
  await f.receive();assert.equal(f.batches.length,1);
});
test('guest invocation accepts an additional active username and rejects a retired stored username',async t=>{
  const f=guestFixture(t,{profile:{id:42,username:'new_primary',active_usernames:['new_primary','alias_bot']}});
  await f.receive(guestMessage({id:'alias',text:'@alias_bot hello',entities:[{type:'mention',offset:0,length:10}]}));
  assert.equal(f.batches.length,1);
  await f.receive(guestMessage({id:'retired',text:'@bot hello'}));
  assert.equal(f.batches.length,1);
});
test('guest replies never inherit the quoted owner; explicit mention selects the new author',async t=>{
  const f=guestFixture(t);f.db.saveChat('b',{id:2,type:'private'});f.db.setRole('b',2,'user');const other=f.db.ensureAgent('b',2);
  await f.receive(guestMessage({userId:2,text:'tomorrow?',entities:[],reply_to_message:{from:{id:42},guest_bot_caller_user:{id:1}}}));assert.equal(f.batches.length,0);
  await f.receive(guestMessage({userId:2,reply_to_message:{from:{id:42},guest_bot_caller_user:{id:1}}}));assert.equal(f.batches[0].scope.agentId,other.agentId);
});
test('missing disabled and unauthorized personal agents stay silent without creation',async t=>{
  for(const state of ['missing','disabled','unauthorized','stopping']){
    const f=guestFixture(t,{personal:state!=='missing'});
    if(state==='disabled')f.db.sql.prepare('UPDATE chats SET agentEnabled=0').run();
    if(state==='stopping')f.db.sql.prepare('UPDATE agents SET stopPending=1').run();
    const message=state==='unauthorized'?guestMessage({userId:2}):guestMessage();
    if(state==='unauthorized'){f.db.saveChat('b',{id:2,type:'private'});f.db.ensureAgent('b',2);}
    await f.receive(message);assert.equal(f.batches.length,0,state);assert.equal(f.calls.length,0,state);
    if(state==='missing')assert.equal(f.db.agent('b',1),null);
  }
});
test('independent queued guest invocations keep handles and destinations through batching',async t=>{
  const f=guestFixture(t);f.c.queue.setPaused(f.owner.agentId,true);
  await f.c.receive('b',{update_id:1,guest_message:guestMessage({id:'one',chatId:-1})});
  await f.c.receive('b',{update_id:2,guest_message:guestMessage({id:'two',chatId:-2})});
  assert.equal(f.c.queue.pending(f.owner.agentId),2);
  f.c.queue.setPaused(f.owner.agentId,false);await f.c.queue.idle();
  const events=f.batches.flatMap(x=>x.events);assert.equal(events.length,2);assert.notEqual(events[0].guestRequestId,events[1].guestRequestId);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM guest_requests').get().n,2);
});
test('guest numeric collisions grant no ordinary permissions; member records suppress personal fallback',async t=>{
  const f=guestFixture(t);await f.receive(guestMessage({chatId:1}));assert.equal(f.batches.length,1);assert.equal(f.db.getMessage('b',1,7),null);
  f.db.saveChat('b',{id:-50,type:'supergroup',title:'Connected'});f.db.sql.prepare('UPDATE chats SET agentEnabled=0 WHERE chatId=-50').run();
  await f.receive(guestMessage({id:'member'}));assert.equal(f.batches.length,1);assert.equal(f.db.agent('b',-50),null);
});
test('polling explicitly subscribes to guest messages',async()=>{
  const abort=new AbortController();let options;
  await poll({botId:'b',signal:abort.signal,getOffset:()=>0,setOffset:()=>{},receive:()=>{},telegram:{call:async(_bot,_method,args)=>{options=args;abort.abort();return [];}}});
  assert.ok(options.allowed_updates.includes('guest_message'));
});
