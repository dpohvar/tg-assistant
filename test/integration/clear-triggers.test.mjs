import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTriggers, matchesTrigger } from '../../src/telegram/triggers.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
test('literal triggers use Unicode letter boundaries and exact internal spacing',()=>{
 const list=normalizeTriggers(['Артём','АРТЁМ','добрый помощник']);assert.equal(list.length,2);
 for(const text of ['Артём!','мой_АРТЁМ','Артём123','🙂Артём','Артёмка, Артём!'])assert.equal(matchesTrigger(text,list),true,text);
 for(const text of ['Артёмка','суперАртём','Артем','добрый  помощник'])assert.equal(matchesTrigger(text,list),false,text);
 assert.throws(()=>normalizeTriggers(['a']));assert.throws(()=>normalizeTriggers(Array.from({length:201},(_,i)=>'t'+i)));
});
function setup(t,agent){const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});db.saveChat('b',{id:-1,type:'group',title:'Group'});db.ensureAgent('b',-1);db.setRole('b',2,'manager');const a=db.ensureAgent('b',1);db.sql.prepare('UPDATE agents SET threadRulesVersion=1,threadId=?,notes=? WHERE agentId=?').run('old','keep',a.agentId);const replies=[];const c=createController({db,agent,telegram:{call:async(_b,method,args)=>{if(method==='sendMessage')replies.push(args);return{};}}});t.after(async()=>{c.close();await c.idle();db.close();});return{db,a,c,replies,send:(id,text,chatId=1,userId=1)=>c.receive('b',{message:{message_id:id,date:1791383000,chat:{id:chatId,type:chatId>0?'private':'group'},from:{id:userId},text}})};}
test('clear waits for root and background, preserves queue and identity',async t=>{
 let finishRoot,finishChild;const root=new Promise(r=>finishRoot=r),child=new Promise(r=>finishChild=r);const batches=[],deleted=[];
 const f=setup(t,{run:async(s,e)=>{batches.push(e);if(batches.length===1){await root;return{settled:child};}},deleteSession:async(id,thread)=>deleted.push([id,thread])});
 t.after(()=>{finishRoot();finishChild();});
 await f.send(1,'hello');await new Promise(r=>setImmediate(r));await f.send(2,'/agent clear');await f.send(3,'queued');
 assert.equal(deleted.length,0);finishRoot();await new Promise(r=>setImmediate(r));assert.equal(deleted.length,0);assert.equal(batches.length,1);
 finishChild();await f.c.idle();assert.equal(deleted.length,1);assert.equal(batches.length,2);assert.equal(batches[1][0].messageId,3);
 const current=f.db.agent('b',1);assert.equal(current.agentId,f.a.agentId);assert.equal(current.notes,'keep');assert.equal(current.threadId,null);
});
test('manager configures group triggers and clears current context; trigger activates loud mode',async t=>{
 const batches=[];const f=setup(t,{run:async(s,e)=>batches.push(e),deleteSession:async()=>{}});
 await f.send(1,'/triggers set Артём',-1,2);await f.send(2,'Артём, привет',-1,2);await f.c.idle();assert.equal(batches.length,1);
 await f.send(3,'ещё вопрос',-1,2);await f.c.idle();assert.equal(batches.length,2);
 await f.send(4,'/agent clear',-1,2);assert.match(f.replies.at(-1).text,/Контекст очищен/);
 await f.send(5,'/triggers',-1,2);assert.equal(f.replies.at(-1).entities[0].type,'code');assert.equal(f.replies.at(-1).text,'Артём');
});

test('clear all is bot-scoped and pending resets recover after restart',async t=>{
 const deleted=[];const f=setup(t,{run:async()=>{},deleteSession:async id=>deleted.push(id)});
 const group=f.db.ensureAgent('b',-1);f.db.registerBot({botId:'other',telegramId:99,username:'other',ownerId:1});f.db.saveChat('other',{id:1,type:'private'});const foreign=f.db.ensureAgent('other',1);
 await f.send(1,'/agent clear *');await f.c.idle();assert.deepEqual(new Set(deleted),new Set([f.a.agentId,group.agentId]));assert.equal(deleted.includes(foreign.agentId),false);
 f.c.close();await f.c.idle();
 f.db.sql.prepare('UPDATE agents SET contextResetPending=1,threadId=? WHERE agentId=?').run('restart-thread',f.a.agentId);
 const recovered=[];const c=createController({db:f.db,agent:{deleteSession:async(id,thread)=>recovered.push([id,thread])},telegram:{call:async()=>({})}});
 await c.idle();assert.deepEqual(recovered,[[f.a.agentId,'restart-thread']]);assert.equal(f.db.agent('b',1).contextResetPending,0);c.close();await c.idle();
});
test('trigger replacement is validated atomically and persists across message updates',async t=>{
 const f=setup(t,{run:async()=>{}});await f.send(1,'/triggers set Бот',-1,2);
 await f.send(2,'/triggers set x',-1,2);assert.deepEqual(JSON.parse(f.db.getChat('b',-1).triggers),['Бот']);
 await f.send(3,'Бот, привет',-1,2);await f.c.idle();assert.deepEqual(JSON.parse(f.db.getChat('b',-1).triggers),['Бот']);
 await f.send(4,'/triggers set',-1,2);assert.deepEqual(JSON.parse(f.db.getChat('b',-1).triggers),[]);
});

test('long trigger lists are split into valid replies without losing entries',async t=>{
 const f=setup(t,{run:async()=>{}}),values=Array.from({length:200},(_,i)=>String(i).padStart(3,'0')+'а'.repeat(47));
 f.db.sql.prepare('UPDATE chats SET triggers=? WHERE botId=? AND chatId=?').run(JSON.stringify(values),'b',-1);
 await f.send(1,'/triggers',-1,2);assert.ok(f.replies.length>1);
 assert.deepEqual(f.replies.flatMap(r=>r.text.split('\n')),values);
 for(const r of f.replies){assert.ok(r.text.length<=4000);assert.equal(r.reply_parameters.message_id,1);for(const e of r.entities)assert.equal(r.text.slice(e.offset,e.offset+e.length).length,50);}
});

test('failed clear retains queued events and can be retried without losing them',async t=>{
 let attempts=0;const batches=[];const f=setup(t,{run:async(s,e)=>batches.push(e),deleteSession:async()=>{if(++attempts===1)throw new Error('temporary');}});
 await f.send(1,'/agent clear');assert.equal(f.db.agent('b',1).contextResetPending,1);
 await f.send(2,'queued after error');await f.c.idle();assert.equal(batches.length,0);
 await f.send(3,'/agent clear');await f.c.idle();assert.equal(attempts,2);assert.equal(batches.length,1);assert.equal(batches[0][0].messageId,2);
});
