import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadInvitations} from '../../src/commands/uploads.mjs';
import {createCommands} from '../../src/commands/router.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
const chat={id:-100,type:'supergroup'};
const command={message_id:0,ephemeral_message_id:11,date:100,chat,from:{id:1},receiver_user:{id:42},text:'/upload file.txt'};
const invitation={message_id:0,ephemeral_message_id:21,date:100,chat,from:{id:42,is_bot:true},receiver_user:{id:1},text:'Any invitation text',entities:[]};
const attachment=(quote=invitation,extra={})=>({message_id:0,ephemeral_message_id:31,date:101,chat,from:{id:1},receiver_user:{id:42},reply_to_message:structuredClone(quote),document:{file_id:'doc'},...extra});
function database(t){const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});return db;}
function setup(t){const db=database(t);let at=100000;const store=createUploadInvitations({db,now:()=>at});store.register('b',command,invitation,{name:'upload',args:[{type:'text',value:'file.txt'}]});return {db,store,advance:ms=>at+=ms};}
test('invitation expires at one hour and is absent after creating a fresh in-memory store',t=>{
  const {store,db,advance}=setup(t);assert.equal(createUploadInvitations({db}).acquire('b',attachment()),null);advance(3600000);assert.equal(store.acquire('b',attachment()),null);
});
test('invitation locks a transfer, releases failure and consumes success',t=>{
  const {store}=setup(t);const first=store.acquire('b',attachment());assert.equal(first.entry.name,'upload');assert.equal(store.acquire('b',attachment()).busy,true);first.release();const retry=store.acquire('b',attachment());retry.succeed();retry.release();assert.equal(store.acquire('b',attachment()),null);
});
for(const condition of ['other-bot','other-chat','other-user','other-topic','edited-target','edited-upload','wrong-bot-author','wrong-recipient','reused-id-text','reused-id-date','missing-target'])test(`invitation rejects ${condition}`,t=>{
  const {store}=setup(t),m=attachment();let bot='b';
  if(condition==='other-bot')bot='other';
  if(condition==='other-chat')m.chat={...chat,id:-101};
  if(condition==='other-user')m.from.id=2;
  if(condition==='other-topic'){m.chat={...chat,is_forum:true};m.message_thread_id=2;}
  if(condition==='edited-target')m.reply_to_message.edit_date=101;
  if(condition==='edited-upload')m.edit_date=102;
  if(condition==='wrong-bot-author')m.reply_to_message.from.id=99;
  if(condition==='wrong-recipient')m.reply_to_message.receiver_user.id=2;
  if(condition==='reused-id-text')m.reply_to_message.text='/rules set';
  if(condition==='reused-id-date')m.reply_to_message.date++;
  if(condition==='missing-target')delete m.reply_to_message;
  assert.equal(store.acquire(bot,m),null);
});
function routerSetup(t){
  const db=database(t),calls=[];let next=100,writes=0,fail=false,hold;
  const telegram={call:async(_b,method,args)=>{calls.push({method,args});return method==='sendMessage'?{message_id:0,ephemeral_message_id:++next,date:100,chat,from:{id:42,is_bot:true},receiver_user:{id:args.ephemeral_message_parameters?.receiver_user_id},text:args.text,entities:args.entities??[]}:true;}};
  const router=createCommands({db,config:{dataDir:'.'},clock:()=>100000,telegram,fileCommands:async(_bot,name,args)=>{if(name!=='upload')return 'other';if(hold)await hold;if(fail)throw new Error('download failed');writes++;assert.equal(args[0].value,'wiki/Project notes.md');return 'Saved';},updateRules:async()=>writes++});
  const prompt=()=>calls.findLast(c=>c.method==='sendMessage'&&c.args.text!=='Processing…');
  const quoted=()=>{const p=prompt();return {...invitation,ephemeral_message_id:100+calls.filter(c=>c.method==='sendMessage').length,text:p.args.text,entities:p.args.entities??[]};};
  return {db,router,calls,quoted,writes:()=>writes,fail:value=>fail=value,hold:value=>hold=value};
}
test('group upload invitation stores parsed arguments, retries failure and closes after success',async t=>{
  const r=routerSetup(t),text='/upload wiki/Project notes.md';
  await r.router.handle('b',{...command,text,entities:[{type:'code',offset:8,length:text.length-8}]});const q=r.quoted();
  r.fail(true);assert.equal(await r.router.handle('b',attachment(q)),true);assert.equal(r.writes(),0);
  r.fail(false);assert.equal(await r.router.handle('b',attachment(q)),true);assert.equal(r.writes(),1);
  await r.router.handle('b',attachment(q));assert.equal(r.writes(),1);
});
test('group rules upload uses a registered invitation and keeps admin permission checks',async t=>{
  const r=routerSetup(t);await r.router.handle('b',{...command,text:'/rules set'});const q=r.quoted();
  await r.router.handle('b',attachment(q));assert.equal(r.writes(),1);
  const low={...command,from:{id:2},text:'/rules set'};r.db.setRole('b',2,'manager');await r.router.handle('b',low);assert.equal(r.writes(),1);
});
test('an arbitrary bot command-looking pre block never authorizes a file upload',async t=>{
  const r=routerSetup(t);await r.router.handle('b',attachment({...invitation,text:'/rules set',entities:[{type:'pre',offset:0,length:10}]}));assert.equal(r.writes(),0);
});
test('current permissions are rechecked and a rejected upload can be retried after access is restored',async t=>{
  const r=routerSetup(t),text='/upload wiki/Project notes.md';await r.router.handle('b',{...command,text,entities:[{type:'code',offset:8,length:text.length-8}]});const q=r.quoted();
  r.db.sql.prepare('UPDATE bots SET ownerId=99 WHERE botId=?').run('b');r.db.setRole('b',1,'user');await r.router.handle('b',attachment(q));assert.equal(r.writes(),0);
  r.db.setRole('b',1,'admin');await r.router.handle('b',attachment(q));assert.equal(r.writes(),1);
});
test('simultaneous files for one invitation cannot both write',async t=>{
  const r=routerSetup(t),text='/upload wiki/Project notes.md';await r.router.handle('b',{...command,text,entities:[{type:'code',offset:8,length:text.length-8}]});const q=r.quoted();let release;r.hold(new Promise(resolve=>release=resolve));
  const first=r.router.handle('b',attachment(q));await new Promise(resolve=>setImmediate(resolve));
  await r.router.handle('b',attachment(q,{ephemeral_message_id:32}));assert.equal(r.writes(),0);release();await first;assert.equal(r.writes(),1);
});
