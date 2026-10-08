import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
test('stopping chat fences fresh scheduler and message admission before session deletion completes', async () => {
 const db=openDatabase(':memory:'); db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
 const message={message_id:1,date:1000,chat:{id:-1,type:'group',title:'g'},from:{id:1},text:'@bot'};
 db.saveMessage('b',message); const a=db.ensureAgent('b',-1); let release, runs=0;
 const c=createController({db,telegram:{call:async()=>({})},agent:{deleteSession:()=>new Promise(r=>release=r),run:async()=>{runs++}}});
 c.scheduler.timers=false; const task=c.scheduler.schedule(a,{cron:'* * * * *',timezone:'UTC',description:'test',text:'test'});
 const stopping=c.stopAgent('b',-1,{leave:false});
 await c.receive('b',{message:{...message,message_id:2}});
 c.scheduler.fire(task.taskId, Date.now()); await new Promise(r=>setImmediate(r));
 assert.equal(runs,0); await assert.rejects(c.invoke(c.lifecycle.scope(a),'time',{}));
 release(); await stopping; c.close(); db.close();
});
