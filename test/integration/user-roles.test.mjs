import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {dynamicTools} from '../../src/codex/threads.mjs';

function fixture(t, type='group') {
  const db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  db.registerBot({botId:'other',telegramId:43,username:'other',ownerId:9});
  for(const [id,role] of [[2,'admin'],[3,'manager'],[4,'user']])db.setRole('b',id,role);
  db.setRole('other',5,'admin');
  const chatId=type==='private'?1:-1;db.saveChat('b',{id:chatId,type,title:'test'});
  const a=db.ensureAgent('b',chatId),calls=[];
  const c=createController({db,telegram:{call:async(...args)=>{calls.push(args);throw new Error('Telegram must not be called');}},agent:{run:async()=>{}}});
  t.after(async()=>{c.close();await c.idle();db.close();});
  return {db,c,calls,scope:c.lifecycle.scope({botId:'b',chatId,agentId:a.agentId})};
}
for(const type of ['group','supergroup','private'])test(`user_roles reads only current bot roles in ${type}`,async t=>{
  const f=fixture(t,type);
  const result=await f.c.invoke(f.scope,'user_roles',{userIds:[4,1,2,3,5,99,1]});
  assert.deepEqual(result,{users:[{userId:4,role:'user'},{userId:1,role:'owner'},{userId:2,role:'admin'},{userId:3,role:'manager'},{userId:5,role:null},{userId:99,role:null},{userId:1,role:'owner'}]});
  assert.equal(f.calls.length,0);
  assert.deepEqual(await f.c.invoke(f.scope,'user_roles',{userIds:[5],botId:'other'}),{users:[{userId:5,role:null}]});
  assert.deepEqual(await f.c.invoke(f.scope,'user_roles',{userIds:[]}),{users:[]});
});
test('user_roles reads role changes and ownership transfers without cached answers',async t=>{
  const f=fixture(t),read=()=>f.c.invoke(f.scope,'user_roles',{userIds:[1,2]});
  assert.equal((await read()).users[1].role,'admin');
  f.db.setRole('b',2,'user');assert.equal((await read()).users[1].role,'user');
  f.db.sql.prepare('DELETE FROM roles WHERE botId=? AND userId=?').run('b',2);
  assert.equal((await read()).users[1].role,null);
  f.db.setRole('b',1,'admin');f.db.sql.prepare('UPDATE bots SET ownerId=? WHERE botId=?').run(2,'b');
  assert.deepEqual((await read()).users,[{userId:1,role:'admin'},{userId:2,role:'owner'}]);
});
test('invalid user IDs fail explicitly instead of returning role null',async t=>{
  const f=fixture(t);
  for(const userIds of [undefined,null,1,'1',[0],[-1],[1.5],['1'],[null],[Number.MAX_SAFE_INTEGER+1],[1,0]]){
    await assert.rejects(f.c.invoke(f.scope,'user_roles',{userIds}),e=>e.code==='invalid_argument'&&/positive safe integers/.test(e.message));
  }
});
test('user_roles is a read-only dynamic tool with explicit array schema',()=>{
  const tool=dynamicTools.find(x=>x.name==='user_roles');assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required,['userIds']);
  assert.equal(tool.inputSchema.properties.userIds.items.type,'integer');
  assert.match(tool.description,/current|fresh/i);assert.match(tool.description,/Telegram/);
});
