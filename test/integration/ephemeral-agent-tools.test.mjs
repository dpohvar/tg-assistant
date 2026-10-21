import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {createEphemeralStore} from '../../src/ephemeral/store.mjs';
import {createEphemeralMessages} from '../../src/ephemeral/messages.mjs';
import {dynamicTools} from '../../src/codex/threads.mjs';
import {helpSections} from '../../src/commands/help.mjs';
import {registerGroupCommands} from '../../src/commands/registration.mjs';
const chat={id:-100,type:'supergroup'};
test('tool contracts expose private address alternatives and group users discover /say',async()=>{
  for(const name of ['read','edit','delete']){const s=dynamicTools.find(t=>t.name===name).inputSchema;assert(s.properties.ephemeralMessageId);assert(s.properties.receiverUserId);assert(s.oneOf.some(r=>r.required.includes('ephemeralMessageId')));}
  assert(dynamicTools.find(t=>t.name==='send').inputSchema.properties.ephemeral_message_parameters);
  const calls=[];await registerGroupCommands({botId:'b',telegram:{call:async(...args)=>calls.push(args)}});assert(calls.every(c=>c[2].commands.some(d=>d.command==='say'&&d.is_ephemeral)));
  const help=helpSections({role:'user',group:true});assert(help.say.commands.some(c=>c.syntax==='/say MESSAGE'));assert.match(help.say.description,/user/);
});
function fixture(t,{uploads}={}){
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',chat);const scope=db.ensureAgent('b',-100),store=createEphemeralStore(db,{now:()=>200000}),calls=[];let next=100,reject;
  const telegram={call:async(_b,method,args,options)=>{calls.push({method,args,options});if(reject)throw reject;return method.startsWith('send')?{message_id:0,ephemeral_message_id:++next,date:200,chat,from:{id:42,is_bot:true},receiver_user:{id:args.ephemeral_message_parameters.receiver_user_id},text:args.text}:true;}};
  store.record(scope,{message_id:0,ephemeral_message_id:11,date:100,chat,from:{id:1},receiver_user:{id:42},text:'hello'},{direction:'incoming'});
  const address={ephemeralMessageId:21,receiverUserId:1};store.record(scope,{message_id:0,ephemeral_message_id:21,date:100,chat,from:{id:42,is_bot:true},receiver_user:{id:1},text:'Request received.'},{direction:'outgoing'});
  const api=createEphemeralMessages({db,store,telegram,access:createAccess(db),assertCurrent:()=>{},uploads:uploads??(async(_s,local)=>Object.entries(local??{}).map(([name,p])=>({name,filename:p,bytes:Buffer.from('fixture')})))});
  return {db,scope,store,calls,api,address,reject:error=>reject=error};
}
test('agent reads incoming hidden content and edits/deletes the prepared bot reply after the initial window',async t=>{
  const f=fixture(t);assert.equal(f.api.read(f.scope,{ephemeralMessageId:11}).messages[0].text,'hello');
  const result=await f.api.edit(f.scope,{...f.address,text:'Answer'});assert.deepEqual(result.updated,['text']);assert.equal(result.ephemeralMessageId,21);
  assert.equal(f.calls[0].method,'editEphemeralMessageText');assert.equal(f.calls[0].args.receiver_user_id,1);assert.equal(f.store.get(f.scope,f.address).message.text,'Answer');
  await f.api.delete(f.scope,f.address);assert.equal(f.calls[1].method,'deleteEphemeralMessage');assert.equal(f.db.sql.prepare('SELECT count(*) n FROM messages').get().n,0);
});
test('native hidden reply infers its recipient, preserves uploads and returns a private address',async t=>{
  const f=fixture(t),result=await f.api.send(f.scope,{document:'attach://doc',uploads:{doc:'wiki/file.txt'},reply_parameters:{ephemeral_message_id:11}});
  assert.equal(result.receiverUserId,1);assert.equal(result.messageIds,undefined);assert(result.ephemeralMessageId>0);
  assert.deepEqual(f.calls[0].args.ephemeral_message_parameters,{receiver_user_id:1});assert.equal(f.calls[0].options.uploads[0].name,'doc');
});
test('hidden sends and edits prepare file references without changing rich Markdown',async t=>{
  const f=fixture(t);
  const result=await f.api.send(f.scope,{photo:'file:wiki/image.png',reply_parameters:{ephemeral_message_id:11}});
  assert(result.ephemeralMessageId>0);assert.match(f.calls[0].args.photo,/^attach:\/\//);assert.equal(f.calls[0].options.uploads[0].filename,'wiki/image.png');
  const markdown='![](tg://photo?id=pic)';
  await f.api.edit(f.scope,{...f.address,rich_message:{markdown,media:[{id:'pic',media:{type:'photo',media:'file:wiki/image.png'}}]}});
  assert.equal(f.calls[1].args.rich_message.markdown,markdown);assert.match(f.calls[1].args.rich_message.media[0].media.media,/^attach:\/\//);
  assert.equal(f.calls[1].options.uploads.length,1);
});
test('private tools reject wrong ownership, mixed selectors, incoming edits, mismatched recipients and unsupported content before Telegram',async t=>{
  const f=fixture(t);
  assert.throws(()=>f.api.read({...f.scope,agentId:'other'},{ephemeralMessageId:11}),{code:'ephemeral_message_unavailable'});
  for(const args of [{...f.address,messageId:0},{...f.address,inlineMessageId:'id'},{...f.address,chatId:-101},{ephemeralMessageId:11,receiverUserId:42}])await assert.rejects(f.api.edit(f.scope,{...args,text:'bad'}));
  for(const args of [{text:'bad',reply_parameters:{ephemeral_message_id:11,message_id:1}},{text:'bad',reply_parameters:{ephemeral_message_id:11},ephemeral_message_parameters:{receiver_user_id:2}},{poll:{question:'x'},ephemeral_message_parameters:{receiver_user_id:1}},{media:[],ephemeral_message_parameters:{receiver_user_id:1}},{text:'bad',ephemeral_message_parameters:{receiver_user_id:1},reply_markup:{inline_keyboard:[[{text:'go',callback_data:'x'}]]}}])await assert.rejects(f.api.send(f.scope,args));
  assert.equal(f.calls.length,0);
});
test('Telegram rejection stays private; uncertain sends are not retried and uncertain edits mark their snapshots',async t=>{
  const f=fixture(t);f.reject(Object.assign(new Error('reply window expired'),{code:'telegram_api_error'}));
  const result=await f.api.send(f.scope,{text:'late',reply_parameters:{ephemeral_message_id:11}});assert.equal(result.error,'telegram_api_error');assert.equal(f.calls.length,1);
  f.reject(Object.assign(new Error('unknown'),{code:'telegram_transport_failed'}));const edited=await f.api.edit(f.scope,{...f.address,text:'maybe'});assert.equal(edited.error,'delivery_unknown');assert.equal(f.store.get(f.scope,f.address).deliveryUnknown,true);
  await assert.rejects(f.api.edit(f.scope,{...f.address,text:'repeat'}),{code:'delivery_unknown'});assert.equal(f.calls.length,2);
});
test('nested private contact/location/venue input cannot override protected routing fields',async t=>{
  const f=fixture(t);for(const kind of ['contact','location','venue'])await assert.rejects(f.api.send(f.scope,{[kind]:{latitude:1,longitude:2,phone_number:'123',first_name:'Private',ephemeral_message_parameters:null},ephemeral_message_parameters:{receiver_user_id:1}}),{code:'invalid_argument'});assert.equal(f.calls.length,0);
});
test('queued parallel edits cannot overwrite a prior uncertain outcome',async t=>{
  let release,entered,uploads=0;const held=new Promise(resolve=>release=resolve),firstEntered=new Promise(resolve=>entered=resolve);
  const f=fixture(t,{uploads:async()=>{if(++uploads===1){entered();await held;}return [];}});
  f.reject(Object.assign(new Error('unknown'),{code:'telegram_transport_failed'}));const first=f.api.edit(f.scope,{...f.address,text:'first'});await firstEntered;const second=f.api.edit(f.scope,{...f.address,text:'second'});await new Promise(resolve=>setImmediate(resolve));release();assert.equal((await first).error,'delivery_unknown');await assert.rejects(second,{code:'delivery_unknown'});assert.equal(f.calls.length,1);assert.equal(f.store.get(f.scope,f.address).deliveryUnknown,true);
});
test('private source ownership/generation is revalidated after asynchronous upload preparation',async t=>{
  let invalidate;const f=fixture(t,{uploads:async()=>{invalidate();return [];}});
  invalidate=()=>assert.throws(()=>f.store.record(f.scope,{message_id:0,ephemeral_message_id:11,date:101,chat,from:{id:1},receiver_user:{id:42},text:'replacement'},{direction:'incoming'}),{code:'ephemeral_address_reused'});
  await assert.rejects(f.api.send(f.scope,{text:'answer',reply_parameters:{ephemeral_message_id:11}}),{code:'ephemeral_message_unavailable'});assert.equal(f.calls.length,0);
});
