import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createMessages} from '../../src/messages/actions.mjs';
test('all send kinds and single/batch transfers use destination topics without local fields',async()=>{
 const db=openDatabase(':memory:');try{
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});const chat={id:-1,type:'supergroup',is_forum:true},calls=[];db.saveChat('b',chat);
 db.saveMessage('b',{message_id:1,date:1,chat,message_thread_id:9,text:'source'});
 const scope={botId:'b',chatId:-1};let next=100;
 const messages=createMessages({db,access:{assertRead(){},assertWrite(){}},assertCurrent(){},telegram:{call:async(_b,method,body)=>{calls.push({method,body});if(method==='copyMessage')return {message_id:++next};if(method.endsWith('Messages'))return body.message_ids.map(()=>({message_id:++next}));const value={message_id:++next,date:2,chat,...(body.message_thread_id?{message_thread_id:body.message_thread_id}:{}),text:'sent'};return method==='sendMediaGroup'?[value]:value;}}});
 for(const payload of [{text:'t'},{rich_message:{blocks:[]}},{photo:'https://example.org/p.jpg'},{document:'https://example.org/d.txt'},{media:[{type:'photo',media:'https://example.org/p.jpg'}]},{location:{latitude:1,longitude:2}}]){
  assert.ok((await messages.send(scope,{...payload,topicId:4})).messageIds);assert.equal(calls.at(-1).body.message_thread_id,4);assert.equal(calls.at(-1).body.topicId,undefined);
 }
 await messages.send(scope,{text:'General',topicId:1});assert.equal(calls.at(-1).body.message_thread_id,undefined);
 const before=calls.length;assert.equal((await messages.send(scope,{text:'bad',topicId:1,reply_parameters:{message_id:1}})).error,'invalid_argument');assert.equal(calls.length,before);
 assert.ok((await messages.send(scope,{text:'cross',topicId:4,reply_parameters:{message_id:1}})).messageIds);
 for(const name of ['copy','forward'])for(const messageIds of [[1],[1,2]]){assert.ok((await messages.transfer(scope,name,{messageIds,topicId:4})).messageIds);assert.equal(calls.at(-1).body.message_thread_id,4);}
 const copied=await messages.transfer(scope,'copy',{messageIds:[1],topicId:5});assert.equal(db.messageRecord('b',-1,copied.messageIds[0]).topicId,5);
 const general=await messages.transfer(scope,'copy',{messageIds:[1]});assert.equal(db.messageRecord('b',-1,general.messageIds[0]).topicId,1);
 const unknown=await messages.transfer(scope,'copy',{messageIds:[1],reply_parameters:{message_id:999}});
 assert.equal(db.getMessage('b',-1,unknown.messageIds[0]).topicUnknown,true);
 const unknownBefore=calls.length;assert.equal((await messages.send(scope,{text:'unsafe',topicId:1,reply_parameters:{message_id:unknown.messageIds[0]}})).error,'invalid_argument');assert.equal(calls.length,unknownBefore);
 db.saveChat('b',{id:-1,type:'supergroup'});const count=calls.length;assert.equal((await messages.send(scope,{text:'off',topicId:4})).error,'invalid_argument');assert.equal(calls.length,count);
 }finally{db.close();}
});
test('failed topic sends never retry or mark the registry deleted',async()=>{
 const db=openDatabase(':memory:');try{
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:-1,type:'supergroup',is_forum:true});let calls=0;
 const messages=createMessages({db,access:{assertWrite(){}},assertCurrent(){},telegram:{call:async()=>{calls++;throw Object.assign(new Error('message thread not found'),{code:'telegram_api_error'});}}});
 const result=await messages.send({botId:'b',chatId:-1},{topicId:77,text:'gone'});assert.equal(result.error,'telegram_api_error');assert.equal(calls,1);
 }finally{db.close();}
});
