import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createCommands} from '../../src/commands/router.mjs';
test('tasks reply contains full instructions and Telegram formatting entities with pagination',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:1,type:'private'});db.ensureAgent('b',1);
 const rows=[{taskId:'t1',at:'2026-10-08T01:16:13Z',description:'Reminder <&>',text:'Say `done` 😀'}, {taskId:'t2',cron:'* * * * *',timezone:'Asia/Nicosia',description:'',text:''}],calls=[];
 for(const row of rows)row.agentId=db.agent('b',1).agentId;
 const c=createCommands({db,config:{},scheduler:{queued:new Set(),list:()=>({tasks:rows}),task:id=>rows.find(t=>t.taskId===id)},telegram:{call:async(_b,_m,args)=>{calls.push(args);}}});
 const send=text=>c.handle('b',{message_id:5,chat:{id:1,type:'private'},from:{id:1},text});
 await send('/task list 1');const out=calls.pop();assert.ok(out.text.startsWith('1-1 / 2\n'));assert.equal(out.reply_parameters.message_id,5);
 assert.equal(out.parse_mode,undefined);assert.deepEqual(out.entities.map(e=>[e.type,out.text.slice(e.offset,e.offset+e.length)]),[['code','t1'],['italic',rows[0].at],['bold',rows[0].description],['pre',rows[0].text]]);
 await send('/task list 2');assert.deepEqual(calls.pop().entities.map(e=>e.type),['code','italic']);
 rows[0].text='😀'.repeat(5000);await send('/task list 1');const long=calls.pop();assert.ok(long.text.length<=4096);assert.ok(long.text.endsWith('[обрезано]'));assert.ok(long.entities.every(e=>e.offset+e.length<=long.text.length));
});
