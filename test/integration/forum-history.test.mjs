import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createHistory} from '../../src/agents/history.mjs';
test('topic filters apply before anchors and remain in cursors after forum mode is off',()=>{
 const db=openDatabase(':memory:');try{
 db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});const scope={botId:'b',agentId:'a',chatId:-1};
 for(let i=1;i<=6;i++)db.saveMessage('b',{message_id:i,date:i,chat:{id:-1,type:'supergroup',is_forum:true},...(i%2?{message_thread_id:4}:{}),text:`message ${i}`});
 db.saveMessage('b',{message_id:7,date:7,chat:{id:-1,type:'supergroup'},message_thread_id:99,text:'ordinary'});
 const h=createHistory({db,access:{assertRead(){}},key:'key'});
 assert.deepEqual(h.history(scope,{topicId:4,from:-2,to:0}).messages.map(m=>m.messageId),[3,5]);
 assert.throws(()=>h.history(scope,{topicId:4,messageId:2,from:-2,to:0}));
 const page=h.search(scope,{topicId:4,limit:1});assert.equal(page.messages[0].messageId,5);
 assert.equal(h.search(scope,{cursor:page.nextCursor}).messages[0].messageId,3);
 assert.deepEqual(h.history(scope,{topicId:1,from:-10,to:0}).messages.map(m=>m.messageId),[2,4,6,7]);
 assert.equal(h.history(scope,{from:-10,to:0}).messages.length,7);
 assert.equal(h.read(scope,{messageIds:[1]}).messages[0].message_thread_id,4);
 assert.equal(h.read(scope,{messageIds:[2]}).messages[0].message_thread_id,undefined);
 assert.throws(()=>h.search(scope,{topicId:0}));
 }finally{db.close();}
});
