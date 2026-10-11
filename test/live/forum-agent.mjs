import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';
import {createController} from '../../src/controller.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';

// Native Codex start/resume in the production permission profile; synthetic input, real Telegram sends.
// Run as the ordinary server user. Does not poll or touch production DB/rules/workspaces.
const [configFile,tokenFile,chatValue,root]=process.argv.slice(2),chatId=Number(chatValue);
assert(configFile&&tokenFile&&root&&Number.isSafeInteger(chatId)&&chatId<0);
const server=JSON.parse(fs.readFileSync(configFile,'utf8'));
fs.mkdirSync(root,{recursive:true});
const config={...server,dataDir:path.join(root,'control'),botsDir:path.join(root,'bots')};
const telegram=createTelegram({getToken:async()=>fs.readFileSync(tokenFile,'utf8').trim()});
const me=await telegram.call('probe','getMe'),chat=await telegram.call('probe','getChat',{chat_id:chatId});assert.equal(chat.is_forum,true);
const db=openDatabase(path.join(config.dataDir,'controller.sqlite'));
if(!db.getBot('probe'))db.registerBot({botId:'probe',telegramId:me.id,username:me.username,ownerId:server.serviceOwnerId});
db.saveChat('probe',chat);const record=db.ensureAgent('probe',chatId),sent=[],tools=[],failures=[],owned=[];
const wrapped={async call(bot,method,args,options){const result=await telegram.call(bot,method,args,options);if(method==='sendMessage'){sent.push(result);console.log(JSON.stringify({sent:true,topic:result.message_thread_id??1}));}return result;}};
const agent=new CodexAgent({db,config}),controller=createController({db,telegram:wrapped,agent,onError:e=>failures.push(e.code??'agent_failed')});
const timeout=setTimeout(()=>controller.close(),150000);
try{
 for(const name of ['A','B'])owned.push(await telegram.call('probe','createForumTopic',{chat_id:chatId,name:'Temporary agent probe '+name}));
 for(let index=0;index<3;index++){
  if(index===1)agent.detach(record.agentId); // Exercise native resume with the newly configured schemas.
  const topicId=index<2?owned[index].message_thread_id:1;
  await controller.receive('probe',{message:{message_id:900000001+index,date:Math.floor(Date.now()/1000),chat,from:{id:server.serviceOwnerId,first_name:'Operator'},...(topicId>1?{message_thread_id:topicId,is_topic_message:true}:{}),text:`@${me.username} Authorized bounded forum test: call topics once, then send exactly one text message "FORUM AGENT PROBE ${index+1}" into this event's topic using explicit topicId. Do not reply: this input is synthetic. No other actions.`,entities:[{type:'mention',offset:0,length:me.username.length+1}]}});
  await controller.idle();assert.deepEqual(failures,[]);assert.equal(sent.length,index+1);assert.equal(sent.at(-1).message_thread_id??1,topicId);
  console.log(JSON.stringify({turn:index+1,topicRoutingPassed:true,threadPresent:!!db.agent('probe',chatId).threadId}));
 }
 assert.equal(db.sql.prepare('SELECT count(*) n FROM agents').get().n,1);
 console.log(JSON.stringify({passed:true,realModel:true,syntheticInputs:true,turns:3,oneAgent:true,startAndResume:true}));
}finally{
 clearTimeout(timeout);controller.close();await controller.idle();
 const saved=db.agent('probe',chatId);try{await agent.deleteSession(saved.agentId,saved.threadId);}catch{}
 const cleanup=[];
 for(const topic of owned)try{await telegram.call('probe','deleteForumTopic',{chat_id:chatId,message_thread_id:topic.message_thread_id});}catch{cleanup.push('temporary topic');}
 for(const message of sent.filter(m=>!m.message_thread_id))try{await telegram.call('probe','deleteMessage',{chat_id:chatId,message_id:message.message_id});}catch{cleanup.push('General message');}
 db.close();if(cleanup.length)throw new Error('Probe cleanup incomplete: '+cleanup.join(', '));
}
