import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';import {createController} from '../../src/controller.mjs';
test('MCP refresh waits for turn, holds queued input, keeps thread and notes',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:1,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1);db.sql.prepare('UPDATE agents SET threadId=?,notes=?,threadRulesVersion=? WHERE agentId=?').run('native-thread','note',db.getBot('b').rulesVersion,a.agentId);
 let finish;const root=new Promise(r=>finish=r),order=[];const agent={run:async(s,e)=>{order.push('run');if(order.length===1)await root;},refreshSession:async()=>order.push('refresh')};const c=createController({db,agent,telegram:{call:async()=>({})}});t.after(async()=>{finish();c.close();await c.idle();});
 const send=(text,id,entities=[])=>c.receive('b',{message:{message_id:id,date:1,chat:{id:1,type:'private'},from:{id:1},text,entities}});
 await send('first',1);await new Promise(r=>setImmediate(r));const config='url="https://example.com/mcp"';const text='/mcp set demo '+config;await send(text,2,[{type:'pre',offset:14,length:config.length}]);await send('queued',3);assert.deepEqual(order,['run']);finish();await c.idle();assert.deepEqual(order,['run','refresh','run']);assert.equal(db.agent('b',1).threadId,'native-thread');assert.equal(db.agent('b',1).notes,'note');
});
