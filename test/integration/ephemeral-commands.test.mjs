import test from 'node:test';
import assert from 'node:assert/strict';
import {registerGroupCommands} from '../../src/commands/registration.mjs';
import {createCommandReply} from '../../src/commands/replies.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createCommands} from '../../src/commands/router.mjs';
import {createController} from '../../src/controller.mjs';

const ephemeral=(extra={})=>({message_id:0,ephemeral_message_id:101,date:100,chat:{id:-100,type:'supergroup'},from:{id:1},receiver_user:{id:42,is_bot:true},text:'/agent',...extra});
function transport(){const calls=[];return {calls,call:async(bot,method,args,options)=>{calls.push({bot,method,args,options});return method==='sendMessage'?{message_id:0,ephemeral_message_id:1000+calls.length,date:100,chat:{id:args.chat_id,type:'supergroup'},from:{id:42,is_bot:true},receiver_user:{id:args.ephemeral_message_parameters?.receiver_user_id},text:args.text}:true;}};}
function timer(){let callback,ms;return {setTimeout:(fn,delay)=>{callback=fn;ms=delay;return 1;},clearTimeout:()=>{callback=undefined;},fire:async()=>{callback?.();await new Promise(resolve=>setImmediate(resolve));},delay:()=>ms};}
test('fast ephemeral commands send their response without Processing',async()=>{
  const telegram=transport(),timers=timer(),reply=createCommandReply({telegram,botId:'b',message:ephemeral(),now:()=>100000,timers});
  await reply.start();assert.equal(telegram.calls.length,0);assert.equal(timers.delay(),5000);
  await reply.telegram.call('b','sendMessage',{chat_id:-100,text:'Fast',reply_parameters:{message_id:0}});await timers.fire();
  assert.equal(telegram.calls.length,1);assert.equal(telegram.calls[0].args.text,'Fast');
});
test('ephemeral command completion edits its private acknowledgement after the response window',async()=>{
  const telegram=transport(),timers=timer();let at=100000;
  const reply=createCommandReply({telegram,botId:'b',message:ephemeral(),now:()=>at,timers});
  await reply.start();at+=5000;await timers.fire();at+=55000;
  await reply.telegram.call('b','sendMessage',{chat_id:-100,text:'Done',reply_parameters:{message_id:0}});
  assert.equal(telegram.calls[0].args.ephemeral_message_parameters.receiver_user_id,1);
  assert.equal(telegram.calls[0].args.reply_parameters.ephemeral_message_id,101);
  assert.equal(telegram.calls[1].method,'editEphemeralMessageText');
  assert.equal(telegram.calls[1].args.text,'Done');assert.equal(telegram.calls[1].args.receiver_user_id,1);
});
test('document command responses privately replace the acknowledgement with media and preserve uploads',async()=>{
  const telegram=transport(),timers=timer(),reply=createCommandReply({telegram,botId:'b',message:ephemeral(),now:()=>100000,timers});
  await reply.start();await timers.fire();const options={uploads:[{name:'file',bytes:Buffer.from('ok'),filename:'file.txt'}]};
  await reply.telegram.call('b','sendDocument',{chat_id:-100,document:'attach://file',reply_parameters:{message_id:0}},options);
  assert.equal(telegram.calls[1].method,'editEphemeralMessageMedia');assert.deepEqual(telegram.calls[1].args.media,{type:'document',media:'attach://file'});assert.equal(telegram.calls[1].options.uploads,options.uploads);assert(telegram.calls[1].options.signal instanceof AbortSignal);
});
test('fresh unedited invitation and source deletion use native ephemeral addresses',async()=>{
  const telegram=transport(),reply=createCommandReply({telegram,botId:'b',message:ephemeral(),now:()=>100000});
  await reply.start({processing:false});const invitation=await reply.invite({text:'Attach a document'});
  assert(invitation.ephemeral_message_id);assert.equal(telegram.calls[0].method,'sendMessage');assert.equal(telegram.calls.length,1);assert.equal(invitation.edit_date,undefined);
  await reply.telegram.call('b','deleteMessage',{chat_id:-100,message_id:0});
  assert(telegram.calls.some(c=>c.method==='deleteEphemeralMessage'&&c.args.ephemeral_message_id===101));
});
test('ordinary and unrelated publication transports stay ordinary',async()=>{
  const telegram=transport(),ordinary=createCommandReply({telegram,botId:'b',message:{message_id:3,chat:{id:1,type:'private'},from:{id:1}}});
  await ordinary.start();await ordinary.telegram.call('b','sendMessage',{chat_id:1,text:'ordinary',reply_parameters:{message_id:3}});
  const reply=createCommandReply({telegram,botId:'b',message:ephemeral(),now:()=>100000});
  await reply.start();await reply.telegram.call('b','sendMessage',{chat_id:-100,text:'Public widget'});
  assert.equal(telegram.calls[0].args.ephemeral_message_parameters,undefined);assert.equal(telegram.calls.at(-1).args.ephemeral_message_parameters,undefined);
});
test('a rejected ephemeral response never falls back to public delivery',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:-100,type:'supergroup'});let starts=0;
  const calls=[],router=createCommands({db,config:{},clock:()=>100000,setAgentState:()=>{starts++;return 'Enabled';},telegram:{call:async(_b,method,args)=>{calls.push({method,args});throw new Error('expired');}}});
  assert.equal(await router.handle('b',ephemeral({text:'/agent start'})),true);assert.equal(starts,1);assert.equal(calls.length,1);assert(calls.every(c=>c.args.ephemeral_message_parameters));
});
test('an expired private command is terminal and does not mutate state or poison polling',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:-100,type:'supergroup'});let changes=0;
  const router=createCommands({db,config:{},clock:()=>200000,setAgentState:()=>changes++,telegram:{call:()=>assert.fail('expired reply')}});
  assert.equal(await router.handle('b',ephemeral({text:'/agent start'})),true);assert.equal(changes,0);
});
test('closing a command response cancels its timer and rejects late private output',async()=>{
  const telegram=transport(),timers=timer(),reply=createCommandReply({telegram,botId:'b',message:ephemeral(),now:()=>100000,timers});
  await reply.start();reply.close();await timers.fire();
  await assert.rejects(reply.telegram.call('b','sendMessage',{chat_id:-100,text:'late',reply_parameters:{message_id:0}}),/closed/);
  assert.equal(telegram.calls.length,0);
});
test('closing a bot invalidates in-flight command responses',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});let release;
  const held=new Promise(resolve=>release=resolve),telegram=transport(),router=createCommands({db,clock:()=>100000,config:{},telegram,models:async()=>held});
  const work=router.handle('b',ephemeral({text:'/agent models'}));await new Promise(resolve=>setImmediate(resolve));router.close('b');release(['model']);await work;assert.equal(telegram.calls.length,0);
});

test('child group command lists declare native ephemeral commands for users and administrators',async()=>{
  const calls=[];
  await registerGroupCommands({botId:'child',telegram:{call:async(...args)=>calls.push(args)}});
  assert.equal(calls.length,6);
  assert.deepEqual(new Set(calls.map(c=>c[2].scope.type)),new Set(['all_group_chats','all_chat_administrators']));
  assert.deepEqual(new Set(calls.map(c=>c[2].language_code)),new Set(['','en','ru']));
  for(const [bot,method,args] of calls){
    assert.equal(bot,'child');assert.equal(method,'setMyCommands');
    assert(args.commands.every(c=>c.is_ephemeral===true&&c.description));
    for(const command of ['help','agent','widget','upload','rules'])assert(args.commands.some(c=>c.command===command));
    assert(args.commands.length<=100);
  }
});
test('master commands are not registered for groups',async()=>{
  await registerGroupCommands({botId:'master',telegram:{call:()=>assert.fail('master registration')}});
});
for(const kind of ['message','edited_message','callback_query','quoted-private'])test(`deferred ephemeral ${kind} never reaches ordinary history or agent delivery`,async t=>{
  const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:-100,type:'supergroup'});db.ensureAgent('b',-100);
  const batches=[],telegram=transport(),controller=createController({db,clock:()=>100000,config:{},telegram,agent:{run:async(_scope,events)=>batches.push(events)}});
  t.after(async()=>{controller.close();await controller.idle();db.close();});
  const m=ephemeral({text:'@test private text'});
  const update=kind==='callback_query'?{callback_query:{id:'cb',from:{id:1},message:m,data:'yes'}}:kind==='quoted-private'?{message:{message_id:5,date:100,chat:m.chat,from:{id:1},text:'@test reply',reply_to_message:{...m,from:{id:42}}}}:{[kind]:m};
  await controller.receive('b',update);await controller.queue.idle();
  assert.equal(db.sql.prepare('SELECT count(*) n FROM messages').get().n,0);assert.equal(batches.length,0);
  await controller.receive('b',{message:{message_id:6,date:100,chat:m.chat,from:{id:1},text:'unrelated ordinary'}});await controller.queue.idle();assert.equal(batches.length,0);
});
test('controller runs a recognized ephemeral command without saving ordinary ID zero',async t=>{
  const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:-100,type:'supergroup'});
  const telegram=transport(),controller=createController({db,clock:()=>100000,config:{},telegram,agent:{run:async()=>assert.fail('model execution')}});
  t.after(async()=>{controller.close();await controller.idle();db.close();});
  await controller.receive('b',{message:ephemeral({text:'/help'})});
  assert.equal(db.sql.prepare('SELECT count(*) n FROM messages WHERE messageId=0').get().n,0);
  assert(telegram.calls.some(c=>c.method==='sendMessage'&&c.args.ephemeral_message_parameters?.receiver_user_id===1));
  assert(telegram.calls.every(c=>c.method!=='sendMessage'||c.args.text!=='Processing…'));
});
