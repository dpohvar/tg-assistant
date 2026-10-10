import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';import {createController} from '../../src/controller.mjs';
function setup(t){const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'ricardo_bot',ownerId:1});db.saveChat('b',{id:-1,type:'group',title:'Friends'});db.ensureAgent('b',-1);db.sql.prepare('UPDATE chats SET triggers=? WHERE botId=? AND chatId=?').run(JSON.stringify(['Рик','рикардо']),'b',-1);const batches=[];let release;
 const c=createController({db,agent:{run:async(s,e)=>{batches.push(e);if(release)await release;}},telegram:{call:async()=>({})}});t.after(async()=>{c.close();await c.idle();db.close();});
 const send=(message,edited=false)=>c.receive('b',{[edited?'edited_message':'message']:{date:1791383000,chat:{id:-1,type:'group',title:'Friends'},from:{id:1,first_name:'Andrey'},...message}});
 return{db,c,batches,send,block:p=>release=p};}
test('delivery names only this bot mention, all matching phrases and reply without duplicates',async t=>{
 const f=setup(t),text='🙂 @other_bot @RiCaRdO_bot @ricardo_bot РИК, рикардо!';const mentions=[...text.matchAll(/@\w+/g)].map(m=>({type:'mention',offset:m.index,length:m[0].length}));
 await f.send({message_id:1,text,entities:mentions,reply_to_message:{message_id:99,from:{id:42,is_bot:true}}});await f.c.idle();
 assert.deepEqual(f.batches[0][0].triggers,['mention:@RiCaRdO_bot','reply','match:Рик','match:рикардо']);
 assert.equal(f.db.getMessage('b',-1,1).triggers,undefined);
 await f.send({message_id:2,text:'Обращаюсь к Андрею'});await f.c.idle();assert.equal(f.batches[1][0].triggers,undefined);
 await f.send({message_id:3,chat:{id:1,type:'private'},text:'Рик'});await f.c.idle();assert.equal(f.batches[2][0].triggers,undefined);
});
test('caption triggers work, automatic forwards do not match custom phrases',async t=>{
 const f=setup(t);await f.send({message_id:1,caption:'@ricardo_bot Рик',caption_entities:[{type:'mention',offset:0,length:12}],document:{file_id:'file'}});await f.c.idle();assert.deepEqual(f.batches[0][0].triggers,['mention:@ricardo_bot','match:Рик']);
 await f.send({message_id:2,text:'Рик',is_automatic_forward:true});await f.c.idle();assert.equal(f.batches[1][0].triggers,undefined);
});
test('album retains per-part reasons rather than treating every photo as a direct trigger',async t=>{
 const f=setup(t);await f.send({message_id:1,media_group_id:'album',photo:[{width:100,height:100}],caption:'Рик'});await f.send({message_id:2,media_group_id:'album',photo:[{width:100,height:100}]});
 await new Promise(r=>setTimeout(r,1100));await f.c.idle();assert.equal(f.batches.length,1);assert.deepEqual(f.batches[0][0].triggers,['match:Рик']);assert.equal(f.batches[0][1].triggers,undefined);
});
test('editing a queued message retains the original cause of delivery',async t=>{
 const f=setup(t);let finish;f.block(new Promise(r=>finish=r));t.after(()=>finish());await f.send({message_id:1,text:'Рик, работай'});await new Promise(r=>setImmediate(r));await f.send({message_id:2,text:'Рик, ещё вопрос'});await f.send({message_id:2,text:'Исправленный вопрос',edit_date:1791383001},true);finish();await f.c.idle();
 assert.deepEqual(f.batches[1][0].triggers,['match:Рик']);assert.equal(f.batches[1][0].textPlain,'Исправленный вопрос');
});
test('foreign mentions do not activate the bot; trigger beyond shortened text still explains delivery',async t=>{
 const f=setup(t);await f.send({message_id:1,text:'@other_bot привет',entities:[{type:'mention',offset:0,length:10}]});await f.c.idle();assert.equal(f.batches.length,0);
 await f.send({message_id:2,text:'x'.repeat(1100)+' Рик'});await f.c.idle();assert.deepEqual(f.batches[0][0].triggers,['match:Рик']);assert.equal(f.batches[0][0].truncated,true);assert.equal(f.batches[0][0].textPlain.includes('Рик'),false);
});
