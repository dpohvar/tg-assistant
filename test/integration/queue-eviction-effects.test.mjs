import {test} from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../../src/storage/database.mjs';import {createController} from '../../src/controller.mjs';
test('private Telegram overflow retains history and marks the next event with historyGap',async t=>{
 const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1),batches=[],c=createController({db,telegram:{call:async()=>true},agent:{run:async(_s,events)=>batches.push(events)}});t.after(async()=>{c.close();await c.idle();db.close();});await c.ready;c.queue.setPaused(a.agentId,true);
 for(let i=1;i<=11;i++)await c.receive('b',{message:{message_id:i,date:1,chat:{id:1,type:'private'},from:{id:1},text:'message '+i}});
 assert.equal(c.queue.pending(a.agentId),10);assert.ok(db.getMessage('b',1,1));c.queue.setPaused(a.agentId,false);await c.idle();assert.equal(batches[0][0].messageId,2);assert.equal(batches[0][0].historyGap,true);
});
