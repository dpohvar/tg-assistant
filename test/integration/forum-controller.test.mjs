import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {createFileCommands} from '../../src/commands/files.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function fixture(t,run,respond){
 const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});
 const chat={id:-1,type:'supergroup',is_forum:true};db.saveChat('b',chat);
 let now=1000;const batches=[],calls=[];
 const c=createController({db,clock:()=>now,telegram:{call:async(_b,method,args)=>{calls.push({method,args});return respond?.(method,args)??{};}},agent:{run:async(s,e)=>{batches.push(e);await run?.(batches.length,s,e);}}});
 t.after(async()=>{c.close();await c.idle();db.close();});
 const send=(id,topic=1,trigger=false,extra={})=>c.receive('b',{message:{message_id:id,date:100+id,chat,from:{id:1},...(topic>1?{message_thread_id:topic}:{}),text:trigger?'@test':'question',...(trigger?{entities:[{type:'mention',offset:0,length:5}]}:{}),...extra}});
 return {db,c,chat,batches,calls,send,advance:()=>now+=120001};
}
test('forums are connected passively and start as one agent; service events do not dispatch',async t=>{
 const f=fixture(t);await f.send(1,4,true);assert.ok(f.db.getChat('b',-1));assert.equal(f.batches.length,0);assert.equal(f.calls.some(c=>c.method==='leaveChat'),false);
 await f.send(2,4,false,{text:'/agent start'});assert.equal(f.db.getChat('b',-1).agentEnabled,1);
 await f.send(3,4,true,{text:'@test',forum_topic_edited:{name:'renamed'}});await f.c.idle();assert.equal(f.batches.length,0);
 await f.send(4,4,true);await f.c.idle();assert.equal(f.batches[0][0].topicId,4);
 await f.send(5,1,true);await f.c.idle();assert.equal(f.db.sql.prepare('SELECT count(*) n FROM agents').get().n,1);
 assert.equal(f.calls[0].args.message_thread_id,4);
});
test('loud mode and history gaps belong to topics independently',async t=>{
 const f=fixture(t);f.db.ensureAgent('b',-1);
 await f.send(1,4);await f.send(2,5);await f.send(3,4,true);await f.c.idle();assert.equal(f.batches[0][0].historyGap,true);
 await f.send(4,5);await f.c.idle();assert.equal(f.batches.length,1);
 await f.send(5,4);await f.c.idle();assert.equal(f.batches[1][0].historyGap,undefined);
 await f.send(6,5,true);await f.c.idle();assert.equal(f.batches[2][0].historyGap,true);
 f.advance();await f.send(7,4);await f.send(8,5,true);await f.c.idle();assert.equal(f.batches[3][0].historyGap,undefined);
 await f.send(9,4,true);await f.c.idle();assert.equal(f.batches[4][0].historyGap,true);
});
test('mixed queued topics receive their own gaps and forum mode transitions preserve the agent',async t=>{
 let finish;t.after(()=>finish?.());const f=fixture(t,n=>n===1?new Promise(r=>finish=r):undefined);const a=f.db.ensureAgent('b',-1);
 await f.send(1,1,true);await new Promise(r=>setImmediate(r));await f.send(2,4);await f.send(3,5);await f.send(4,4,true);await f.send(5,5,true);finish();await f.c.idle();
 assert.deepEqual(f.batches[1].map(e=>[e.topicId,e.historyGap]),[[4,true],[5,true]]);
 f.advance();await f.send(6,4);
 delete f.chat.is_forum;await f.send(7,1,true);await f.c.idle();assert.equal(f.batches.at(-1)[0].historyGap,true);assert.equal(f.batches.at(-1)[0].topicId,undefined);
 f.chat.is_forum=true;await f.send(8,1);await f.c.idle();assert.equal(f.batches.at(-1)[0].topicId,1);
 assert.equal(f.db.agent('b',-1).agentId,a.agentId);assert.equal(f.calls.some(c=>c.method==='leaveChat'),false);
});

test('callback uses the saved message topic and the ten-event queue is shared across topics',async t=>{
 let finish;t.after(()=>finish?.());const f=fixture(t,n=>n===1?new Promise(r=>finish=r):undefined);const a=f.db.ensureAgent('b',-1);
 f.db.saveMessage('b',{message_id:100,date:1,chat:f.chat,message_thread_id:4,text:'button',reply_markup:{inline_keyboard:[[{text:'click',callback_data:'click'}]]}});
 await f.send(1,1,true);await new Promise(r=>setImmediate(r));
 await f.c.receive('b',{callback_query:{id:'x',from:{id:1},message:{message_id:100,chat:{id:-1,type:'supergroup'}},data:'click'}});
 for(let i=2;i<=10;i++)await f.send(i,5,true);
 await f.send(11,4,true);assert.equal(f.c.queue.pending(a.agentId),10);
 await f.c.receive('b',{callback_query:{id:'full',from:{id:1},message:{message_id:100,chat:f.chat},data:'click'}});
 assert.match(f.calls.at(-1).args.text,/занят/);finish();await f.c.idle();
 assert.equal(f.batches[1][0].eventType,'button');assert.equal(f.batches[1][0].topicId,4);
 assert.equal(f.batches[1].filter(e=>e.eventType==='message').length,9);
});
test('albums stay in their topic and consume one loud allowance after assembly',async t=>{
 const f=fixture(t);f.db.ensureAgent('b',-1);
 await f.send(1,4,true);await f.c.idle();
 for(let i=2;i<=3;i++)await f.send(i,4,false,{media_group_id:'same',photo:[{file_id:'p',width:10,height:10}]});
 await new Promise(r=>setTimeout(r,1100));await f.c.idle();assert.equal(f.batches[1].length,2);assert.equal(f.batches[1].every(e=>e.topicId===4),true);
 for(let i=4;i<=12;i++)await f.send(i,4);await f.c.idle();const before=f.batches.flat().length;
 await f.send(13,4);await f.send(14,5);await f.c.idle();assert.equal(f.batches.flat().length,before);
 await f.send(15,5,true);await f.c.idle();assert.equal(f.batches.at(-1)[0].historyGap,true);
});
test('topics tool uses history read access and stop/clear retain its registry',async t=>{
 const f=fixture(t);const a=f.db.ensureAgent('b',-1),scope=f.c.lifecycle.scope({botId:'b',chatId:-1,agentId:a.agentId});
 await f.send(1,4,false,{forum_topic_created:{name:'Four'}});
 assert.equal((await f.c.invoke(scope,'topics',{})).topics[1].name,'Four');
 await assert.rejects(f.c.invoke(scope,'topics',{chatId:999}));
 await f.send(2,4,false,{text:'/agent stop'});await f.c.idle();assert.equal(f.db.sql.prepare('SELECT name FROM topics WHERE topicId=4').get().name,'Four');
 await f.send(3,4,false,{text:'/agent clear'});await f.c.idle();assert.equal(f.db.sql.prepare('SELECT name FROM topics WHERE topicId=4').get().name,'Four');
});

test('native send mode observations merge pending topic gaps',async t=>{
 const f=fixture(t,undefined,(method,args)=>method==='sendMessage'?{message_id:100,date:200,chat:{id:-1,type:'supergroup'},text:args.text}:{}),a=f.db.ensureAgent('b',-1);await f.send(1,4);
 const scope=f.c.lifecycle.scope({botId:'b',chatId:-1,agentId:a.agentId});
 await f.c.invoke(scope,'send',{text:'sent after forum disable'});
 delete f.chat.is_forum;await f.send(2,1,true);await f.c.idle();assert.equal(f.batches[0][0].historyGap,true);
});
test('pre-forum and edited historical buttons retain correct forum listening buckets',async t=>{
 const f=fixture(t);f.db.ensureAgent('b',-1);const ordinary={id:-1,type:'supergroup'};
 const keyboard={inline_keyboard:[[{text:'Click',callback_data:'click'}]]};
 f.db.saveMessage('b',{message_id:100,date:1,chat:ordinary,text:'old',reply_markup:keyboard});f.db.saveChat('b',f.chat);
 const click=id=>f.c.receive('b',{callback_query:{id:String(id),from:{id:1},message:{message_id:id,chat:f.chat},data:'click'}});
 await click(100);await f.c.idle();await f.send(1,1);await f.c.idle();assert.equal(f.batches[0][0].topicId,1);assert.equal(f.batches.length,2);
 f.db.saveMessage('b',{message_id:101,date:1,chat:f.chat,message_thread_id:4,text:'old forum',reply_markup:keyboard});
 f.db.saveMessage('b',{message_id:101,date:1,edit_date:2,chat:ordinary,text:'edited when off',reply_markup:keyboard});f.db.saveChat('b',f.chat);
 await click(101);await f.c.idle();await f.send(2,4);await f.c.idle();assert.equal(f.batches.at(-2)[0].topicId,4);assert.equal(f.batches.at(-1)[0].messageId,2);
});
test('formatted, syntax-error, rules and downloaded command replies target their invoking topic',async t=>{
 const f=fixture(t);f.db.ensureAgent('b',-1);
 await f.send(1,4,false,{text:'/agent list'});assert.equal(f.calls.at(-1).args.message_thread_id,4);assert.ok(f.calls.at(-1).args.entities);
 await f.send(2,4,false,{text:'/agent nonsense'});assert.equal(f.calls.at(-1).args.message_thread_id,4);assert.equal(f.calls.at(-1).args.reply_parameters.message_id,2);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-forum-file-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'b'));fs.writeFileSync(path.join(root,'b','test.txt'),'content');
 const call=async(_b,method,args)=>{f.calls.push({method,args});return {};};
 const files=createFileCommands({db:f.db,config:{botsDir:root},telegram:{call}});
 await files('b','download',[{value:'test.txt'}],{message_id:3,chat:f.chat,message_thread_id:4});assert.equal(f.calls.at(-1).method,'sendDocument');assert.equal(f.calls.at(-1).args.message_thread_id,4);assert.equal(f.calls.at(-1).args.reply_parameters.message_id,3);
 await f.send(4,4,false,{text:'/rules get'});assert.equal(f.calls.at(-1).args.message_thread_id,4);
});
