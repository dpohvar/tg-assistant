import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';

// Opt-in, bounded native API test. No polling or model turn; owns/cleans only its new topic and messages.
const [tokenFile,chatValue]=process.argv.slice(2),chatId=Number(chatValue);
if(!tokenFile||!Number.isSafeInteger(chatId)||chatId>=0)throw new Error('Usage: node test/live/forum-topics.mjs TOKEN_FILE FORUM_CHAT_ID');
const telegram=createTelegram({getToken:async()=>fs.readFileSync(tokenFile,'utf8').trim()});
const me=await telegram.call('probe','getMe'),chat=await telegram.call('probe','getChat',{chat_id:chatId});
assert.equal(chat.is_forum,true,'Requires an enabled forum and bot permission to manage topics.');
const db=openDatabase(':memory:');db.registerBot({botId:'probe',telegramId:me.id,username:me.username,ownerId:me.id});db.saveChat('probe',chat);
const record=db.ensureAgent('probe',chatId),controller=createController({db,telegram,agent:{run:async()=>{}}});
const scope=controller.lifecycle.scope({botId:'probe',chatId,agentId:record.agentId});
const generalMessages=[];let topic;
try{
 topic=await telegram.call('probe','createForumTopic',{chat_id:chatId,name:'Temporary forum application probe'});
 const id=topic.message_thread_id;
 const send=async args=>{const result=await controller.invoke(scope,'send',args);assert.ok(!result.error,JSON.stringify(result));return result.messageIds[0];};
 const source=await send({text:'FORUM APP PROBE: explicit topic',topicId:id});assert.equal(db.messageRecord('probe',chatId,source).topicId,id);
 const general=await send({text:'FORUM APP PROBE: default General'});generalMessages.push(general);assert.equal(db.messageRecord('probe',chatId,general).topicId,1);
 const explicit=await send({text:'FORUM APP PROBE: explicit General',topicId:1});generalMessages.push(explicit);assert.equal(db.messageRecord('probe',chatId,explicit).topicId,1);
 const inherited=await send({text:'FORUM APP PROBE: inherited reply',reply_parameters:{message_id:source}});assert.equal(db.messageRecord('probe',chatId,inherited).topicId,id);
 const refused=await controller.invoke(scope,'send',{text:'must not send',topicId:1,reply_parameters:{message_id:source}});assert.equal(refused.error,'invalid_argument');
 const cross=await send({text:'FORUM APP PROBE: cross-topic reply',topicId:id,reply_parameters:{message_id:general}});const crossMessage=db.getMessage('probe',chatId,cross);assert.equal(crossMessage.message_thread_id,id);assert.equal(crossMessage.external_reply?.message_id,general);
 const rich=await send({topicId:id,rich_message:{blocks:[{type:'paragraph',text:'FORUM APP PROBE: rich topic'}]}});assert.equal(db.messageRecord('probe',chatId,rich).topicId,id);
 for(const name of ['copy','forward'])for(const messageIds of [[general],[general,explicit]]){const result=await controller.invoke(scope,name,{topicId:id,messageIds});assert.ok(!result.error,JSON.stringify(result));}
 const topics=await controller.invoke(scope,'topics',{});assert.equal(topics.enabled,true);assert.ok(topics.topics.some(t=>t.topicId===id&&t.name==='Temporary forum application probe'));
 await telegram.call('probe','deleteForumTopic',{chat_id:chatId,message_thread_id:id});topic=undefined;
 const gone=await controller.invoke(scope,'send',{text:'must not fall back',topicId:id});assert.equal(gone.error,'telegram_api_error');assert.match(gone.description,/thread not found/i);
 console.log(JSON.stringify({passed:true,cases:['General/default','explicit topic','reply inheritance','General guard','cross-topic reply','rich','single/batch copy/forward','embedded name','deleted topic refusal']}));
}finally{
 const cleanup=[];
 if(topic)try{await telegram.call('probe','deleteForumTopic',{chat_id:chatId,message_thread_id:topic.message_thread_id});}catch{cleanup.push('temporary topic');}
 for(const message_id of generalMessages)try{await telegram.call('probe','deleteMessage',{chat_id:chatId,message_id});}catch{cleanup.push('General probe message');}
 controller.close();await controller.idle();db.close();
 if(cleanup.length)throw new Error('Probe cleanup incomplete: '+cleanup.join(', '));
}
