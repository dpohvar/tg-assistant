import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {registerGroupCommands} from '../../src/commands/registration.mjs';

for(const ephemeral of [false,true])test(`controller routes ${ephemeral?'ephemeral':'ordinary'} browse callbacks without enabling an agent`,async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'browse-controller-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.setRole('b',2,'admin');
  const chat={id:ephemeral?-100:2,type:ephemeral?'supergroup':'private'};db.saveChat('b',chat);
  const config={botsDir:path.join(root,'bots'),dataDir:path.join(root,'data')},dir=path.join(config.botsDir,'b');fs.mkdirSync(path.join(dir,'wiki'),{recursive:true});fs.writeFileSync(path.join(dir,'wiki','a.txt'),'content');
  const calls=[],errors=[];let message,next=100,agentRuns=0;
  const telegram={call:async(bot,method,args,options)=>{
    calls.push({bot,method,args,options});
    if(method==='sendRichMessage'){message={message_id:ephemeral?0:++next,...(ephemeral?{ephemeral_message_id:++next,receiver_user:{id:2}}:{}),date:100,from:{id:42,is_bot:true},chat,rich_message:args.rich_message};return structuredClone(message);}
    if(method==='editEphemeralMessageText'||method==='editMessageText'){message={...message,rich_message:args.rich_message};return ephemeral?true:structuredClone(message);}
    return {message_id:++next,chat,from:{id:42},date:100,text:args.text};
  }};
  const controller=createController({db,config,telegram,clock:()=>100000,onError:e=>errors.push(e),agent:{run:async()=>{agentRuns++;},models:async()=>[]}});
  t.after(async()=>{controller.close();await controller.idle();db.close();fs.rmSync(root,{recursive:true,force:true});});
  const input=text=>({message_id:ephemeral?0:++next,...(ephemeral?{ephemeral_message_id:++next,receiver_user:{id:42}}:{}),date:100,from:{id:2},chat,text});
  await controller.receive('b',{message:input('/browse wiki')});assert(calls.some(c=>c.method==='sendRichMessage'),'browse must send rich content through the real command router');
  const find=(value,label)=>{if(!value||typeof value!=='object')return; if(String(value.text).includes(label)&&value.callback_data)return value;for(const child of Object.values(value)){const r=find(child,label);if(r)return r;}};
  for(const label of ['a.txt','Download']){
    const button=find(message.rich_message,label);assert(button,`button ${label}`);await controller.receive('b',{callback_query:{id:'cb-'+(++next),from:{id:2},message:structuredClone(message),data:button.callback_data}});
  }
  assert(message.rich_message.blocks.some(b=>b.type==='document'));assert.equal(agentRuns,0);assert.equal(db.agent('b',chat.id),null);
  await controller.receive('b',{message:input('/ls wiki')});assert.equal(calls.findLast(c=>c.method==='sendMessage').args.text,'a.txt');
  assert.equal(errors.length,0);
  if(ephemeral){for(const call of calls.filter(c=>c.method==='sendRichMessage'))assert.equal(call.args.ephemeral_message_parameters.receiver_user_id,2);assert(calls.some(c=>c.method==='editEphemeralMessageText'));}
});

test('browse is registered as ephemeral and help is available only to administrators',async()=>{
  const {helpSections,resolveHelpSection}=await import('../../src/commands/help.mjs');
  const owner=helpSections({role:'owner',group:true}),user=helpSections({role:'user',group:true});
  assert(owner.file.commands.some(c=>c.syntax==='/browse [DIR]'));assert.equal(user.file,undefined);assert.equal(resolveHelpSection(owner,'browse'),'file');
  const calls=[];await registerGroupCommands({telegram:{call:async(...args)=>calls.push(args)},botId:'b'});
  assert.equal(calls[0][2].commands.find(c=>c.command==='browse')?.is_ephemeral,true);
});
