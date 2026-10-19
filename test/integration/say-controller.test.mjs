import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
const chat={id:-100,type:'supergroup'},message=(text='/say hello',extra={})=>({message_id:0,ephemeral_message_id:11,date:100,chat,from:{id:2,first_name:'User'},receiver_user:{id:42,is_bot:true},text,...extra});
function fixture(t,{run,role='user',enabled=true,failPreparation=false,holdPreparation}={}){
  const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',chat);if(role)db.setRole('b',2,role);const a=db.ensureAgent('b',-100);db.sql.prepare('UPDATE chats SET agentEnabled=? WHERE botId=? AND chatId=?').run(+enabled,'b',-100);
  const calls=[],batches=[],telegram={call:async(_b,method,args)=>{calls.push({method,args});if(method==='sendMessage'&&holdPreparation)await holdPreparation;if(failPreparation&&method==='sendMessage')throw Object.assign(new Error('expired'),{code:'telegram_api_error'});return method==='sendMessage'?{...(args.ephemeral_message_parameters?{message_id:0,ephemeral_message_id:100+calls.length,receiver_user:{id:args.ephemeral_message_parameters.receiver_user_id}}:{message_id:100+calls.length}),date:100,chat,from:{id:42,is_bot:true},text:args.text}:true;}};
  const c=createController({db,clock:()=>100000,telegram,config:{},agent:{run:async(scope,events,invoke)=>{batches.push(events);return run?.(scope,events,invoke);}}});
  t.after(async()=>{c.close();await c.idle();db.close();});return {db,c,a,calls,batches,receive:m=>c.receive('b',{message:m})};
}
test('user /say uses the chat queue, preserves formatting and full reads, and edits its prepared reply',async t=>{
  const f=fixture(t,{run:async(_s,events,invoke)=>{const e=events[0];const full=await invoke('read',{ephemeralMessageId:e.ephemeralMessageId});assert.equal(full.messages[0].entities[0].offset,0);assert.equal(full.messages[0].entities[0].type,'bold');assert.equal(full.messages[0].text,'hello');const result=await invoke('edit',{...e.preparedReply,text:'private answer'});assert.equal(result.error,undefined);}});
  await f.receive(message('/say hello',{entities:[{type:'bot_command',offset:0,length:4},{type:'bold',offset:5,length:5}]}));await f.c.idle();
  assert.equal(f.batches.length,1);const e=f.batches[0][0];assert.equal(e.eventType,'message');assert.equal(e.messageId,undefined);assert.equal(e.ephemeral,undefined);assert.equal(e.ephemeralMessageId,11);assert.equal(e.textPlain,'hello');assert.deepEqual(e.triggers,['/say']);assert.equal(e.from.userId,2);assert.equal(e.preparedReply.receiverUserId,2);
  assert.equal(f.calls[0].args.text,'Request received.');assert(f.calls.some(c=>c.method==='editEphemeralMessageText'));assert.equal(f.db.sql.prepare('SELECT count(*) n FROM messages WHERE messageId=0').get().n,0);
  await f.receive({message_id:9,date:100,chat,from:{id:2},text:'ordinary unrelated'});await f.c.idle();assert.equal(f.batches.length,1);
});
test('preparation failure still reaches the agent, without a fabricated prepared address or public fallback',async t=>{
  const f=fixture(t,{failPreparation:true});await f.receive(message());await f.c.idle();assert.equal(f.batches.length,1);assert.equal(f.batches[0][0].preparedReply,undefined);assert(f.batches[0][0].replyPreparationError);assert.equal(f.calls.length,1);
});
test('duplicate /say update does not prepare or deliver twice',async t=>{
  const f=fixture(t);await f.receive(message());await f.c.idle();await f.receive(message());await f.c.idle();assert.equal(f.batches.length,1);assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,1);
});
test('user role, enabled state, native privacy and bot addressing are checked before agent delivery',async t=>{
  for(const options of [{role:null},{enabled:false},{}]){
    const f=fixture(t,options);const m=options.role===null||options.enabled===false?message():message('/say hello',{message_id:8,ephemeral_message_id:undefined,receiver_user:undefined});await f.receive(m);await f.c.idle();assert.equal(f.batches.length,0);
  }
  const f=fixture(t);await f.receive(message('/say@other hello'));await f.c.idle();assert.equal(f.batches.length,0);assert.equal(f.calls.length,0);
});
test('full chat queue rejects /say and role revocation prevents an already queued message from dispatching',async t=>{
  const f=fixture(t);f.c.queue.setPaused(f.a.agentId,true);
  for(let i=0;i<10;i++)f.c.queue.enqueue(f.a.agentId,{eventType:'message',messageId:i+1},'chat');
  await f.receive(message());assert.equal(f.c.queue.pending(f.a.agentId),10);assert.equal(f.batches.length,0);assert(!f.calls.some(c=>c.args.text==='Request received.'));
  f.c.queue.clear(f.a.agentId);await f.receive(message('/say next',{ephemeral_message_id:12}));assert.equal(f.c.queue.pending(f.a.agentId),1);f.db.sql.prepare('DELETE FROM roles WHERE botId=? AND userId=?').run('b',2);f.c.queue.setPaused(f.a.agentId,false);await f.c.idle();assert.equal(f.batches.length,0);
});
test('a failed private-only turn does not announce an agent error publicly',async t=>{
  const f=fixture(t,{run:async()=>{throw new Error('private failure');}});await f.receive(message());await f.c.idle();assert.equal(f.batches.length,1);assert(f.calls.filter(c=>c.method==='sendMessage').every(c=>c.args.ephemeral_message_parameters));
});
test('agent may publish publicly and delete the prepared response without leaking hidden input to history',async t=>{
  const f=fixture(t,{run:async(_s,[e],invoke)=>{const result=await invoke('send',{text:'public outcome'});assert(result.messageIds[0]>0);await invoke('delete',e.preparedReply);}});
  await f.receive(message('/say publish publicly'));await f.c.idle();assert(f.calls.some(c=>c.method==='deleteEphemeralMessage'));const saved=f.db.sql.prepare('SELECT json FROM messages').all();assert.equal(saved.length,1);assert.equal(JSON.parse(saved[0].json).text,'public outcome');
});
test('shutdown during response preparation prevents late agent delivery',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),f=fixture(t,{holdPreparation:held});const work=f.receive(message());await new Promise(resolve=>setImmediate(resolve));f.c.close();release();await work;await f.c.idle();assert.equal(f.batches.length,0);
});
test('role revocation during preparation prevents late agent delivery and removes the unused response',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),f=fixture(t,{holdPreparation:held});const work=f.receive(message());await new Promise(resolve=>setImmediate(resolve));f.db.sql.prepare('DELETE FROM roles WHERE botId=? AND userId=?').run('b',2);release();await work;await f.c.idle();assert.equal(f.batches.length,0);assert(f.calls.some(c=>c.method==='deleteEphemeralMessage'));
});
test('fresh controller can edit a persisted prepared response without replaying the old user event',async t=>{
  const f=fixture(t);await f.receive(message());await f.c.idle();const reply=f.batches[0][0].preparedReply;f.c.close();await f.c.idle();
  const calls=[],second=createController({db:f.db,clock:()=>200000,config:{},telegram:{call:async(_b,method,args)=>{calls.push({method,args});return true;}},agent:{run:async()=>assert.fail('old event replayed')}});
  try{const scope=second.lifecycle.scope(f.a);assert.equal((await second.invoke(scope,'edit',{...reply,text:'after restart'})).error,undefined);assert.equal(calls[0].method,'editEphemeralMessageText');assert.equal(calls[0].args.ephemeral_message_id,reply.ephemeralMessageId);}finally{second.close();await second.idle();}
});
test('forum source topic survives private preparation and long input remains fully readable',async t=>{
  const full='😀'.repeat(1002),f=fixture(t,{run:async(_s,[event],invoke)=>{assert.equal(event.topicId,7);assert.equal([...event.textPlain].length,1000);assert.equal(event.truncated,true);const read=await invoke('read',{ephemeralMessageId:event.ephemeralMessageId});assert.equal(read.messages[0].text,full);assert.equal(read.messages[0].message_thread_id,7);}});
  await f.receive(message('/say '+full,{chat:{...chat,is_forum:true},message_thread_id:7,is_topic_message:true}));await f.c.idle();assert.equal(f.batches.length,1);assert.equal(f.calls[0].args.message_thread_id,7);
});
