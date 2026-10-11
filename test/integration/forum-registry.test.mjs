import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createTopicStore} from '../../src/storage/topics.mjs';
test('observed names, states and unknown topics survive mode changes and history cleanup',()=>{
 const db=openDatabase(':memory:');try{
 db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});const store=createTopicStore(db);
 const chat={id:-1,type:'supergroup',is_forum:true};let id=0;
 const save=(topic,date,fields)=>db.saveMessage('b',{message_id:++id,date,chat,...(topic===1?{}:{message_thread_id:topic}),...fields});
 save(7,1,{text:'unknown'});save(4,2,{forum_topic_created:{name:'old'}});save(4,3,{forum_topic_edited:{name:'new'}});
 save(4,4,{reply_to_message:{message_id:4,date:2,chat,message_thread_id:4,forum_topic_created:{name:'old'}}});
 save(1,5,{general_forum_topic_hidden:{}});save(1,6,{general_forum_topic_unhidden:{}});
 assert.deepEqual(store.list('b',-1),{enabled:true,topics:[{topicId:1,name:'General',closed:true,hidden:false},{topicId:4,name:'new',closed:false},{topicId:7,name:null}]});
 save(1,7,{forum_topic_reopened:{}});assert.equal(store.list('b',-1).topics[0].closed,false);
 db.saveChat('b',{id:-1,type:'supergroup'});db.sql.exec('DELETE FROM messages');
 assert.equal(store.list('b',-1).enabled,false);assert.equal(store.list('b',-1).topics[1].name,'new');
 db.sql.exec('DELETE FROM chats');assert.deepEqual(store.list('b',-1).topics,[]);
 }finally{db.close();}
});
test('equal topic IDs are isolated between chats and bots',()=>{
 const db=openDatabase(':memory:');try{
 for(const botId of ['a','b']){db.registerBot({botId,telegramId:botId==='a'?1:2,username:botId,ownerId:1});for(const id of [-1,-2])db.saveMessage(botId,{message_id:4,date:1,chat:{id,type:'supergroup',is_forum:true},message_thread_id:4,forum_topic_created:{name:`${botId}${id}`}});}
 const store=createTopicStore(db);assert.equal(store.list('a',-1).topics[1].name,'a-1');assert.equal(store.list('b',-2).topics[1].name,'b-2');
 }finally{db.close();}
});
test('embedded originals cannot overwrite a rename or close in the same second',()=>{
 const db=openDatabase(':memory:');try{
 db.registerBot({botId:'b',telegramId:42,username:'b',ownerId:1});const chat={id:-1,type:'supergroup',is_forum:true};
 db.saveMessage('b',{message_id:4,date:2,chat,message_thread_id:4,forum_topic_edited:{name:'renamed'},forum_topic_closed:{}});
 db.saveMessage('b',{message_id:5,date:3,chat,message_thread_id:4,reply_to_message:{message_id:1,date:2,chat,message_thread_id:4,forum_topic_created:{name:'original'}}});
 assert.deepEqual(createTopicStore(db).list('b',-1).topics[1],{topicId:4,name:'renamed',closed:true});
 }finally{db.close();}
});
