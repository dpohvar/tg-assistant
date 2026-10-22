// Opt-in bounded acceptance with actual user updates, real Codex, and real Telegram.
// node test/manual/agent-control-telegram.mjs PRIVATE_CONFIG PRIVATE_NATIVE_CONFIG COMPLETED_GROUP_STATE
import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {openDatabase} from '../../src/storage/database.mjs';import {CodexAgent} from '../../src/codex/threads.mjs';
import {createController} from '../../src/controller.mjs';import {createTelegram} from '../../src/telegram/api.mjs';
import {acquireLock} from '../../src/service/lock.mjs';import {registerGroupCommands} from '../../src/commands/registration.mjs';
const credentialFile=path.resolve(process.argv[2]),credentials=JSON.parse(fs.readFileSync(credentialFile,'utf8')),native=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),previous=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
if(credentials.username!=='dpohvar_test_pub_bot'||credentials.controllerActive!==false||!credentials.token||!previous.stoppedAt||!Number.isSafeInteger(previous.groupId))throw Error('Designated test configuration and completed observed group required.');
const release=acquireLock(path.join(path.dirname(credentialFile),'inline-calibration.lock'));
const run=randomBytes(4).toString('hex'),dir=path.resolve('.runtime-check','agent-control-live',run);fs.mkdirSync(dir,{recursive:true});
const state={run,pid:process.pid,startedAt:Date.now(),expiresAt:Date.now()+1800000,groupId:previous.groupId,inputs:0,callbacks:0,privateEvictionEdits:0,modelTurns:0,errors:[],backups:[]};
const save=()=>fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state,null,2),{mode:0o600});
const event=(type,fields={})=>{console.log(JSON.stringify({type,...fields}));fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),type,...fields})+'\n');};
const abort=new AbortController(),receipts=new Map(),base=createTelegram({getToken:()=>credentials.token});let controller,db,agent,offset,previousAllowed,polling=false,cleaning=false,watchBusy=false,sends=0;
async function call(method,args={},options={}){
 if(args.chat_id!==undefined&&![credentials.ownerId,state.groupId].includes(args.chat_id))throw Error('Unobserved destination');
 if(method.startsWith('send')&&++sends>100)throw Error('Send budget exceeded');
 const result=await base.call('control-live',method,args,{...options,signal:AbortSignal.any([cleaning?AbortSignal.timeout(15000):abort.signal,options.signal??AbortSignal.timeout(method==='getUpdates'?20000:120000)])});
 if(method.startsWith('send')&&result?.chat){const target=result.ephemeral_message_id!==undefined?{chat_id:result.chat.id,ephemeral_message_id:result.ephemeral_message_id,receiver_user_id:result.receiver_user.id}:{chat_id:result.chat.id,message_id:result.message_id};receipts.set(JSON.stringify(target),target);}
 if(method==='editEphemeralMessageText'&&args.text?.startsWith('Request was removed')){state.privateEvictionEdits++;save();event('private_eviction_confirmed');}
 if(args.text==='Continuation verified.')state.continuationOutput=true;
 if(method==='editMessageText'&&args.text==='Context compacted.')state.manualCompact=true;
 return result;
}
const telegram={getToken:base.getToken,call:(_id,...args)=>call(...args)},botId='control-live';
const send=text=>call('sendMessage',{chat_id:credentials.ownerId,text,disable_notification:true});
const config={dataDir:dir,botsDir:path.join(dir,'bots'),codexExecutable:native.codexExecutable,codexHome:native.codexHome,defaultTimezone:'UTC',serviceOwnerId:credentials.ownerId};
const fail=e=>{const code=e.code??e.name??'test_failed';state.errors.push(code);save();event('error',{code});};
const timer=setTimeout(()=>abort.abort(),1800000),watch=setInterval(async()=>{
 if(watchBusy||!db)return;watchBusy=true;
 try{
  if(fs.existsSync(path.join(dir,'stop'))){abort.abort();return;}
  const a=db.agent(botId,credentials.ownerId);if(!a)return;
  if(state.longRequested&&!state.longReady){const temp=path.join(config.botsDir,botId,'.temp',a.agentId);if(['root','child'].every(name=>fs.existsSync(path.join(temp,name+'.ready')))){
   state.longReady=true;controller.queue.setHeld(a.agentId,'acceptance-prefix',true);for(let i=0;i<10;i++)controller.queue.enqueue(a.agentId,{eventType:'message',messageId:100000+i,textPlain:`Synthetic queue fixture ${i}; ignore this item. The newest correction is authoritative.`},'chat');save();await send('Both native commands are running. Send /agent cancel here, then send: corrected: send exactly Correction verified. and finish; do not restart earlier work.');event('native_long_ready');
  }}
  const phase=controller.control.status(a.agentId).phase;if(state.longReady&&phase==='paused'&&!state.cancelConfirmed){state.cancelConfirmed=true;const temp=path.join(config.botsDir,botId,'.temp',a.agentId);state.stoppedTicks=['root','child'].map(name=>fs.readFileSync(path.join(temp,name+'.tick'),'utf8'));save();event('cancel_confirmed',{threadRetained:!!db.agent(botId,credentials.ownerId).threadId,pending:controller.queue.pending(a.agentId)});}
 }catch(e){fail(e);}finally{watchBusy=false;}
},500);
async function receive(update){
 const cb=update.callback_query,m=update.message??cb?.message,actor=cb?.from??m?.from;
 if(actor?.id!==credentials.ownerId||!m||![credentials.ownerId,state.groupId].includes(m.chat.id))return;
 if(m.date*1000<state.startedAt-5000&&!cb)return;
 const text=m.text??'';
 if(!cb&&!/^\/(ctest|agent|say)(?:@dpohvar_test_pub_bot)?(?:\s|$)/i.test(text)&&!text.startsWith('corrected:'))return;
 if(++state.inputs>100)throw Error('Input budget exceeded');save();
 const a=db.agent(botId,credentials.ownerId);
 if(text.startsWith('/ctest')){
  const action=text.trim().split(/\s+/)[1];
  if(action==='stop'){abort.abort();return;}
  if(action==='group'){
   db.setRole(botId,credentials.ownerId,'user');state.applicationRole='user';const g=db.agent(botId,state.groupId),scope=controller.lifecycle.scope(g);controller.queue.setHeld(g.agentId,'group-acceptance',true);
   const result=await controller.invoke(scope,'send',{text:'Agent-control test: choose A twice, waiting for the buttons to reopen after the first click.',reply_markup:{inline_keyboard:[[{text:'⬜ A',callback_data:'[control]a'},{text:'⬜ B',callback_data:'[control]b'}]]}});state.buttonMessage=result.messageIds?.[0];save();await send('Group phase ready. In the previous test group, press A, wait for it to reopen, press A again, then send the ephemeral command /say overflow check.');event('group_ready');return;
  }
  if(!['begin','long','continue'].includes(action)||m.chat.id!==credentials.ownerId)return;
  if(action==='long'&&state.longRequested)return;
  let instruction=action==='begin'?'Authorized acceptance test. Call context_status, then use send to publish exactly Control test ready. in this current private chat, then finish.':action==='continue'?'Authorized continuation acceptance test. Call compact_context with continuation exactly: After successful compaction, send exactly Continuation verified. in the current private chat and finish. Save no files. Finish the current turn immediately after acceptance.':' ';
  if(action==='long'){
   state.longRequested=true;const command=name=>`Set-Content -LiteralPath .temp/${a.agentId}/${name}.ready -Value ready; 1..300 | ForEach-Object { Set-Content -LiteralPath .temp/${a.agentId}/${name}.tick -Value $_; Start-Sleep -Seconds 1 }`;
   instruction=`Authorized cancellation test on Windows PowerShell. Start a child agent to run: ${command('child')}. In parallel run yourself: ${command('root')}. Start both before waiting; exec yield 1000 ms. Then keep waiting. These are authorized disposable marker writes. Do not send messages, call controller tools, or read other files. Do not use Node.`;
  }
  await controller.receive(botId,{message:{...m,text:instruction,entities:undefined}});event('native_request',{action});return;
 }
 if(cb&&cb.data!=='[control]a'&&cb.data!=='[control]b')return;
 await controller.receive(botId,update);
 if(text.startsWith('corrected:')){state.corrected=true;controller.queue.setHeld(a.agentId,'acceptance-prefix',false);save();event('correction_admitted');}
 if(cb){state.callbacks++;if(state.callbacks===1){const g=db.agent(botId,state.groupId);for(let i=0;i<10;i++)controller.queue.enqueue(g.agentId,{eventType:'message',messageId:200000+i,textPlain:'Synthetic overflow fixture; ignore.'},'chat');await controller.queue.idleActive(g.agentId);state.buttonReopened=!!db.getMessage(botId,state.groupId,state.buttonMessage)?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;event('button_eviction',{reopened:state.buttonReopened});}else event('button_reaccepted');save();}
 if(/^\/say(?:@dpohvar_test_pub_bot)?\s/.test(text)&&m.ephemeral_message_id!==undefined){const g=db.agent(botId,state.groupId);state.sayReceived=true;for(let i=0;i<10;i++)controller.queue.enqueue(g.agentId,{eventType:'message',messageId:300000+i,textPlain:'Synthetic overflow fixture; ignore.'},'chat');await controller.queue.idleActive(g.agentId);save();event('say_overflow',{privateEdits:state.privateEvictionEdits});}
}
try{
 const me=await call('getMe');if(me.username!==credentials.username||me.id!==credentials.botTelegramId)throw Error('Wrong bot');const hook=await call('getWebhookInfo');if(hook.url)throw Error('Active webhook');previousAllowed=hook.allowed_updates;
 const group=await call('getChat',{chat_id:state.groupId}),privateChat=await call('getChat',{chat_id:credentials.ownerId}),member=await call('getChatMember',{chat_id:state.groupId,user_id:me.id});if(!['member','administrator','creator'].includes(member.status))throw Error('Not an observed member group');
 for(const type of ['all_group_chats','all_chat_administrators'])for(const language_code of ['','en','ru']){const target={scope:{type},language_code},commands=await call('getMyCommands',target);state.backups.push({target,commands});save();}await registerGroupCommands({telegram,botId});
 db=openDatabase(path.join(dir,'controller.sqlite'));db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:me.id});db.setRole(botId,credentials.ownerId,'admin');for(const chat of [privateChat,group]){db.saveChat(botId,chat);db.ensureAgent(botId,chat.id);}
 agent=new CodexAgent({db,config});const original=agent.run.bind(agent);agent.run=(...args)=>{state.modelTurns++;save();event('model_turn',{number:state.modelTurns});return original(...args);};
 controller=createController({db,config,agent,telegram,onError:fail});await controller.ready;state.readyAt=Date.now();state.groupTitle=group.title;save();event('ready',{run,stateFile:path.join(dir,'state.json')});
 await send(`Agent-control acceptance ${run} is ready. Send /ctest begin here. Wait for Control test ready., then /agent context and /agent compact. After Context compacted., send /ctest long. Further instructions follow after both commands start. Stop anytime with /ctest stop. Test lifetime: 30 minutes.`);
 while(!abort.signal.aborted){polling=true;const updates=await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:10,allowed_updates:['message','callback_query']});for(const update of updates){await receive(update).catch(fail);offset=update.update_id+1;}save();}
}catch(e){if(!abort.signal.aborted){fail(e);process.exitCode=1;}}
finally{
 clearTimeout(timer);clearInterval(watch);controller?.close();await controller?.idle();cleaning=true;
 for(const backup of state.backups)try{await call(backup.commands.length?'setMyCommands':'deleteMyCommands',{...backup.target,...(backup.commands.length?{commands:backup.commands}:{})});const actual=await call('getMyCommands',backup.target);backup.restored=JSON.stringify(actual)===JSON.stringify(backup.commands);}catch(e){fail(e);}
 for(const target of receipts.values())try{await call(target.ephemeral_message_id?'deleteEphemeralMessage':'deleteMessage',target);}catch{}
 if(polling)try{await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:0,limit:1,allowed_updates:previousAllowed??['message','edited_message','channel_post','edited_channel_post','callback_query','inline_query','guest_message','my_chat_member','message_reaction','message_reaction_count','poll','poll_answer']});}catch(e){fail(e);}
 db?.close();state.stoppedAt=Date.now();save();release();event('stopped',{restored:state.backups.every(b=>b.restored)});
}
