import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {createMessages} from '../../src/messages/actions.mjs';
import {shortMessage} from '../../src/telegram/short-message.mjs';
test('via_bot is visible in short messages and blocks text and permits-only ordinary edits',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const agent=db.ensureAgent('b',1),scope={botId:'b',agentId:agent.agentId,chatId:1},calls=[];
  const message={message_id:7,date:1,chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'User'},text:'test',entities:[{type:'italic',offset:0,length:4}],via_bot:{id:107705060,is_bot:true,username:'bold'}};db.saveMessage('b',message);
  assert.equal(shortMessage(message).viaBot,'bold');assert.equal(shortMessage(message).from.userId,1);assert.equal(shortMessage({...message,via_bot:{id:42}}).viaBot,true);
  const messages=createMessages({db,access:createAccess(db),assertCurrent:()=>{},telegram:{call:async(...args)=>calls.push(args)}});
  for(const change of [{text:'Changed'},{permits:{'*':null}}]){const result=await messages.edit(scope,{messageId:7,...change});assert.equal(result.error,'via_bot_edit_forbidden');}
  assert.equal(calls.length,0);assert.equal(db.getMessage('b',1,7).text,'test');
});
