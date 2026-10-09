import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
function fixture(t){const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});for(const id of [1,2,3])db.saveChat('b',{id,type:'private',first_name:'User'+id});db.setRole('b',2,'manager');db.setRole('b',3,'user');db.saveChat('b',{id:-1,type:'supergroup',title:'Friends'});const replies=[],calls=[],runs=[];const c=createController({db,agent:{run:async(s,e)=>runs.push([s,e]),models:async()=>[{model:'m1'},{model:'m2'}],deleteSession:async()=>{}},telegram:{call:async(b,method,args)=>{calls.push(method);if(method==='sendMessage')replies.push(args);return{};}}});t.after(async()=>{c.close();await c.idle();db.close();});const send=(text,user=1,id=1)=>c.receive('b',{message:{message_id:100,date:1,from:{id:user},chat:{id,type:id<0?'supergroup':'private'},text}});return{db,c,replies,calls,runs,send};}
test('structured commands reject aliases, filter help, and authorize explicit targets',async t=>{
 const f=fixture(t);await f.send('/agent start',2,-1);const a=f.db.agent('b',-1);assert.ok(a);
 await f.send('/agent status',2,-1);assert.match(f.replies.at(-1).text,/Режим: включён/);assert.doesNotMatch(f.replies.at(-1).text,/Модель/);
 await f.send('/agent model',2,-1);assert.match(f.replies.at(-1).text,/Нет доступа/);
 await f.send('/agent stop in -1',2,-1);assert.equal(f.db.getChat('b',-1).agentEnabled,1);
 await f.send('/help',3,3);assert.doesNotMatch(f.replies.at(-1).text,/agent model|user set|git setup/);
 await f.send('/clear',1);assert.match(f.replies.at(-1).text,/Unknown command.*\n\/help/s);
 await f.send('/agent model set in -1 m2');assert.equal(f.db.agent('b',-1).model,'m2');
 await f.send('/agent model set default m1');assert.equal(f.db.agent('b',-1).model,'m2');
 await f.send('/agent stop',2,-1);await f.c.idle();await f.send('/agent model set * m1');assert.equal(f.db.agent('b',-1).model,'m1');assert.equal(f.db.getChat('b',-1).agentEnabled,0);
});
test('task bulk operates in one chat, retries coalesce, and disabled retries do not start',async t=>{
 const f=fixture(t);await f.send('/agent start',2,-1);const a=f.db.agent('b',-1),other=f.db.ensureAgent('b',1);
 const make=agent=>f.c.scheduler.schedule(agent,{description:'test',text:'test',at:'2099-01-01T00:00:00Z'});const x=make(a),y=make(a),z=make(other);
 await f.send('/agent stop',2,-1);await f.c.idle();f.c.scheduler.fire(x.taskId,Date.now());await f.send('/task retry *',2,-1);assert.equal(f.db.getChat('b',-1).agentEnabled,0);assert.match(f.replies.at(-1).text,/выключен/);
 await f.send('/task delete *',2,-1);assert.equal(f.c.scheduler.task(x.taskId),undefined);assert.equal(f.c.scheduler.task(y.taskId),undefined);assert.ok(f.c.scheduler.task(z.taskId));
});
test('messages filter by source/destination before pagination and stay bot scoped',async t=>{
 const f=fixture(t),a=f.db.ensureAgent('b',1),b=f.db.ensureAgent('b',-1);
 for(const [from,to,date,text] of [[a.agentId,b.agentId,1,'out'],[b.agentId,a.agentId,2,'in']])f.db.sql.prepare('INSERT INTO agent_messages(botId,fromAgentId,toAgentId,date,text) VALUES(?,?,?,?,?)').run('b',from,to,date,text);
 await f.send(`/agent messages 1 from agent ${a.agentId}`);assert.match(f.replies.at(-1).text,/out/);assert.doesNotMatch(f.replies.at(-1).text,/\nin/);
 await f.send('/agent messages to chat -1');assert.match(f.replies.at(-1).text,/out/);
 await f.send('/agent messages from agent not-found');assert.match(f.replies.at(-1).text,/not found/);
});
test('ownership transfer demotes previous owner and requires an authorized successor',async t=>{
 const f=fixture(t);await f.send('/owner set 99');assert.equal(f.db.getBot('b').ownerId,1);await f.send('/owner set 3');assert.equal(f.db.getBot('b').ownerId,3);assert.equal(f.db.role('b',1),'admin');await f.send('/owner set 2',1);assert.equal(f.db.getBot('b').ownerId,3);
});

test('incomplete structured filters fail with section help',async t=>{const f=fixture(t);for(const text of ['/agent messages chat','/agent messages from','/task list agent','/task list a123','/task retry * agent a123']){await f.send(text);assert.match(f.replies.at(-1).text,/\/help (agent|task)/);}});
