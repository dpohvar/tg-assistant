import test from 'node:test';
import assert from 'node:assert/strict';
import {topicIdOf, topicFields, destinationFields} from '../../src/telegram/topics.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
test('forum affiliation is distinct from ordinary discussion threads',()=>{
 assert.equal(topicIdOf({chat:{is_forum:true},message_thread_id:42}),42);
 assert.equal(topicIdOf({chat:{is_forum:true}}),1);
 assert.equal(topicIdOf({chat:{type:'supergroup'},message_thread_id:42}),null);
 assert.deepEqual(topicFields({chat:{type:'private'}}),{});
});
test('General uses omission and explicit reply destinations are checked',()=>{
 const chat={is_forum:true};
 assert.deepEqual(destinationFields({chat,topicId:1}),{});
 assert.deepEqual(destinationFields({chat,topicId:42}),{message_thread_id:42});
 assert.throws(()=>destinationFields({chat:{},topicId:42}));
 assert.throws(()=>destinationFields({chat,topicId:0}));
 assert.throws(()=>destinationFields({chat,topicId:1,hasReply:true,replyMessage:{chat,message_thread_id:42}}));
 assert.throws(()=>destinationFields({chat,topicId:1,hasReply:true}));
 assert.deepEqual(destinationFields({chat,hasReply:true}),{});
});
test('database stores forum affiliation and migrates registry with chat data',()=>{
 const db=openDatabase(':memory:');try{
 db.registerBot({botId:'b',telegramId:2,username:'bot',ownerId:1});
 db.saveMessage('b',{message_id:1,date:1,chat:{id:-1,type:'supergroup',is_forum:true},message_thread_id:42,text:'x'});
 assert.equal(db.messageRecord('b',-1,1).topicId,42);
 db.migrateChat('b',-1,{id:-2,type:'supergroup',is_forum:true});
 assert.equal(db.messageRecord('b',-2,1).topicId,42);
 assert.equal(db.sql.prepare('SELECT topicId FROM topics WHERE chatId=-2 AND topicId=42').get().topicId,42);
 }finally{db.close();}
});
