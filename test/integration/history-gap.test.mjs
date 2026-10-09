import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
function fixture(t, run) {
 const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:-1,type:'group'});db.ensureAgent('b',-1);
 let now=1000; const batches=[];
 const c=createController({db,clock:()=>now,telegram:{call:async()=>({})},agent:{run:async(s,e)=>{batches.push(e);await run?.(batches.length,s,e);}}});
 t.after(async()=>{c.close();await c.idle();db.close();});
 return {c,batches,advance:()=>now+=120001,send:(id,trigger=false)=>c.receive('b',{message:{message_id:id,date:1791383000,chat:{id:-1,type:'group'},from:{id:1},text:trigger?'@test':'question',...(trigger?{entities:[{type:'mention',offset:0,length:5}]}:{})}})};
}
test('missed group history hints once; fresh misses during a running batch survive its completion',async t=>{
 let finish; t.after(()=>finish?.()); const f=fixture(t,n=>n===1?new Promise(r=>finish=r):undefined);
 await f.send(1);await f.send(2,true);await new Promise(r=>setImmediate(r));
 assert.equal(f.batches[0][0].historyGap,true);
 f.advance();await f.send(3);await f.send(4,true);finish();await f.c.idle();
 assert.equal(f.batches[1][0].historyGap,true);
 await f.send(5);await f.c.idle();assert.equal(f.batches[2][0].historyGap,undefined);
});
test('queue overflow and expired queued group messages produce history gap hints',async t=>{
 let finish;t.after(()=>finish?.());const f=fixture(t,n=>n===1?new Promise(r=>finish=r):undefined);
 await f.send(1,true);await new Promise(r=>setImmediate(r));
 for(let i=2;i<=11;i++)await f.send(i);
 await f.send(12,true);finish();await f.c.idle();assert.equal(f.batches[1][0].historyGap,true);
 await f.send(13);await f.c.idle();assert.equal(f.batches[2][0].historyGap,undefined);
});
