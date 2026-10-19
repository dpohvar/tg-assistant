// Opt-in actual-controller acceptance, confined to a previously observed test group.
// node test/manual/ephemeral-command-acceptance.mjs PRIVATE_CONFIG COMPLETED_PROBE_STATE [SECONDS]
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireLock} from '../../src/service/lock.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {registerGroupCommands} from '../../src/commands/registration.mjs';

if(!process.argv[2]||!process.argv[3])throw new Error('Explicit test config and completed group probe required.');
const configFile=path.resolve(process.argv[2]),credentials=JSON.parse(fs.readFileSync(configFile,'utf8'));
const previous=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]),'utf8')),seconds=Number(process.argv[4]??1800);
if(credentials.controllerActive!==false||credentials.username!=='dpohvar_test_pub_bot'||!credentials.token||!Number.isSafeInteger(credentials.ownerId)||!Number.isSafeInteger(credentials.botTelegramId))throw new Error('Unsafe test configuration.');
if(!previous.stoppedAt||!Number.isSafeInteger(previous.groupId)||previous.groupId>=0||!['group','supergroup'].includes(previous.groupType)||!previous.backups?.length||!previous.backups.every(b=>b.restored===true))throw new Error('Completed observed group probe required.');
if(!Number.isSafeInteger(seconds)||seconds<30||seconds>1800)throw new Error('Duration must be 30..1800 seconds.');
const release=acquireLock(path.join(path.dirname(configFile),'inline-calibration.lock'));
const sayMode=process.argv[5]==='say',control=sayMode?'saccept':'eaccept';
const run=randomBytes(3).toString('hex'),startedAt=Date.now(),directory=path.resolve('.runtime-check',sayMode?'say-acceptance':'ephemeral-acceptance',run),botId='ephemeral-acceptance';
fs.mkdirSync(directory,{recursive:true});
const state={run,mode:sayMode?'say':'commands',agentRuns:0,startedAt,expiresAt:startedAt+seconds*1000,groupId:previous.groupId,backups:[],inputs:[],outputs:[],files:[],errors:[],modelCalls:0,pollCycles:0};
const save=()=>fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state,null,2),{mode:0o600});
const clean=value=>String(value).replaceAll(credentials.token,'[redacted]').slice(0,300);
const record=event=>{const line=JSON.stringify({at:Date.now(),...event});fs.appendFileSync(path.join(directory,'events.jsonl'),line+'\n',{mode:0o600});console.log(line);};
const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),seconds*1000);
const watcher=setInterval(()=>{if(fs.existsSync(path.join(directory,'stop')))stop.abort();},500);
process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
const base=createTelegram({getToken:()=>credentials.token});
let cleaning=false,db,controller,offset,previousAllowed,pollStarted=false,identity=false,sends=0;
const privateReceipts=new Map(),ordinaryReceipts=new Set();
async function call(method,args={},options={}){
  if(args.chat_id!==undefined&&![credentials.ownerId,state.groupId].includes(args.chat_id))throw new Error('Unobserved probe chat.');
  if(method.startsWith('send')&&++sends>120)throw new Error('Probe send budget exceeded.');
  const signals=[cleaning?AbortSignal.timeout(12000):AbortSignal.any([stop.signal,AbortSignal.timeout(method==='getUpdates'?20000:12000)])];
  if(options.signal)signals.push(options.signal);
  const result=await base.call(botId,method,args,{...options,signal:AbortSignal.any(signals)});
  if(method==='deleteEphemeralMessage')privateReceipts.delete(`${args.chat_id}:${args.receiver_user_id}:${args.ephemeral_message_id}`);
  if(method.startsWith('send')&&result&&typeof result==='object'){
    if(result.ephemeral_message_id!==undefined)privateReceipts.set(`${result.chat.id}:${result.receiver_user.id}:${result.ephemeral_message_id}`,{chat_id:result.chat.id,receiver_user_id:result.receiver_user.id,ephemeral_message_id:result.ephemeral_message_id});
    else if(result.chat?.id===state.groupId&&result.message_id>0)ordinaryReceipts.add(result.message_id);
  }
  if(args.chat_id===state.groupId&&/^(send|editEphemeral)/.test(method)){
    state.outputs.push({at:Date.now(),method,ephemeral:!!args.ephemeral_message_parameters||method.startsWith('editEphemeral'),ephemeralId:result?.ephemeral_message_id??args.ephemeral_message_id,text:args.text??null});save();
    record({type:'controller_output',method,ephemeral:state.outputs.at(-1).ephemeral,processing:args.text==='Processing…'});
  }
  return result;
}
const telegram={getToken:base.getToken,call:(_id,method,args,options)=>call(method,args,options)};
const dm=text=>call('sendMessage',{chat_id:credentials.ownerId,text,disable_notification:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function inspectFiles(){
  state.files=[];
  for(const [name,filename] of [['document-first',path.join(directory,'bots',botId,'wiki','document-first.txt')],['invitation',path.join(directory,'bots',botId,'wiki','invitation.txt')],['rules',path.join(directory,'rules',botId,'AGENTS.md')]]){
    if(fs.existsSync(filename)){const bytes=fs.readFileSync(filename);state.files.push({name,size:bytes.length,sha256:hash(bytes)});}
  }
  save();
}
async function receive(update){
  const m=update.message;
  if(!m||m.from?.id!==credentials.ownerId||m.date*1000<startedAt-5000)return;
  const text=m.text??'';
  if(m.chat.type==='private'&&m.chat.id===credentials.ownerId){
    if(text===`/${control} stop ${run}`){stop.abort();return;}
    if(sayMode&&text===`/saccept restart ${run}`&&state.pendingReply){
      controller.close();await controller.idle();db.close();db=openDatabase(path.join(directory,'controller.sqlite'));controller=createTestController();await controller.ready;
      const scope=controller.lifecycle.scope(db.agent(botId,state.groupId));
      const before=await controller.invoke(scope,'read',state.pendingReply);
      if(before.messages[0].text!=='Request received.')throw new Error('Prepared response snapshot did not survive restart.');
      const result=await controller.invoke(scope,'edit',{...state.pendingReply,text:'Say acceptance: edited after restart.'});if(result.error)throw new Error('Restart edit failed: '+result.error);
      state.restartVerified=true;state.pendingReply=null;save();record({type:'restart_verified',historyZero:db.sql.prepare('SELECT count(*) n FROM messages WHERE messageId=0').get().n});
      await dm(`Say acceptance ${run}: stored prepared response edited after controller/database restart.`);return;
    }
    if(text===`/${control} summary`){
      inspectFiles();await dm(`Acceptance ${run}: ${state.inputs.length} inputs; ${state.outputs.length} outputs; errors=${state.errors.length}; model calls=${state.modelCalls}.\n${state.files.map(f=>`${f.name}: ${f.size} bytes, sha256 ${f.sha256.slice(0,12)}`).join('\n')}`);
    }
    return;
  }
  if(m.chat.id!==state.groupId||!['group','supergroup'].includes(m.chat.type))return;
  if(sayMode&&!new RegExp(`^/say(?:@dpohvar_test_pub_bot)?\\s+(private|public|restart)\\s+${run}\\s*$`,'i').test(text))return;
  // Only this acceptance's command families and attachments; never run arbitrary agents.
  if(!sayMode&&!m.document&&!/^\/(help|agent|upload|rules)(?:@dpohvar_test_pub_bot)?(?:\s|$)/i.test(text))return;
  if(/^\/agent(?:@\w+)?\s+(?!models\s*$|status\s*$|invalid\s*$)/i.test(text))return;
  if(/^\/upload(?:@\w+)?\s+/.test(text)&&!/^\/upload(?:@\w+)?\s+wiki\/(document-first|invitation)\.txt\s*$/.test(text))return;
  if(state.inputs.length>=40)throw new Error('Acceptance input budget exceeded.');
  const entry={number:state.inputs.length+1,at:Date.now(),ephemeral:m.ephemeral_message_id!==undefined,ephemeralId:m.ephemeral_message_id,document:!!m.document,quoted:!!m.reply_to_message,command:text.startsWith('/')?text:null};
  state.inputs.push(entry);save();record({type:'controller_input',number:entry.number,ephemeral:entry.ephemeral,document:entry.document,quoted:entry.quoted});
  await controller.receive(botId,update);await controller.idle();inspectFiles();
  record({type:'input_completed',number:entry.number,elapsedMs:Date.now()-entry.at,files:state.files.map(f=>({name:f.name,size:f.size,hash:f.sha256.slice(0,12)}))});
}
function createTestController(){
  const config={dataDir:directory,botsDir:path.join(directory,'bots'),serviceOwnerId:credentials.ownerId};
  return createController({db,telegram,config,onError:error=>{state.errors.push({at:Date.now(),error:clean(error.message)});save();record({type:'controller_error',error:clean(error.message)});},agent:{
    run:async(_scope,events,invoke)=>{
      if(!sayMode){state.modelCalls++;save();throw new Error('Model execution forbidden in command acceptance.');}
      state.agentRuns++;save();
      for(const event of events){
        if(event.eventType!=='message'||!event.triggers?.includes('/say')||!event.ephemeralMessageId||!event.preparedReply)throw new Error('Unexpected /say event envelope.');
        const full=await invoke('read',{ephemeralMessageId:event.ephemeralMessageId});if(full.messages[0].text!==event.textPlain)throw new Error('Hidden full read differs from short test input.');
        state.lastEvent={ephemeralMessageId:event.ephemeralMessageId,preparedReply:event.preparedReply,text:event.textPlain};save();
        if(event.textPlain.startsWith('restart ')){state.pendingReply=event.preparedReply;save();record({type:'restart_ready'});continue;}
        if(event.textPlain.startsWith('public ')){
          const sent=await invoke('send',{text:'Say acceptance: public answer.'});if(sent.error||!sent.messageIds?.length)throw new Error('Public send failed.');
          const deleted=await invoke('delete',event.preparedReply);if(deleted.error)throw new Error('Prepared response deletion failed.');
          state.publicVerified=true;save();record({type:'public_verified'});continue;
        }
        await delay(18000);
        const result=await invoke('edit',{...event.preparedReply,text:'Say acceptance: private answer after 18 seconds.'});if(result.error)throw new Error('Delayed private edit failed: '+result.error);
        state.privateVerified=true;save();record({type:'delayed_private_verified'});
      }
    },
    models:async()=>{await delay(18000);return [{model:'Acceptance complete (18 seconds, no model)'}];},
  }});
}
try{
  const me=await call('getMe');if(me.id!==credentials.botTelegramId||me.username!==credentials.username)throw new Error('Wrong test bot.');identity=true;
  const hook=await call('getWebhookInfo');if(hook.url)throw new Error('Active webhook.');previousAllowed=hook.allowed_updates;
  const group=await call('getChat',{chat_id:state.groupId});
  const member=await call('getChatMember',{chat_id:state.groupId,user_id:me.id});if(!['member','administrator','creator'].includes(member.status))throw new Error('Bot must already belong to observed group.');
  state.membership=member.status;
  for(const type of ['all_group_chats','all_chat_administrators'])for(const language_code of ['','en','ru']){
    const target={scope:{type},language_code},commands=await call('getMyCommands',target);state.backups.push({target,commands,attempted:true});save();
  }
  await registerGroupCommands({telegram,botId});
  for(const backup of state.backups){const current=await call('getMyCommands',backup.target);if(!current.some(c=>c.command===(sayMode?'say':'upload')&&c.is_ephemeral))throw new Error('Ephemeral command registration not confirmed.');}
  db=openDatabase(path.join(directory,'controller.sqlite'));db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:sayMode?me.id:credentials.ownerId});db.saveChat(botId,group);
  if(sayMode){db.setRole(botId,credentials.ownerId,'user');db.ensureAgent(botId,group.id);db.sql.prepare('UPDATE chats SET agentEnabled=1 WHERE botId=? AND chatId=?').run(botId,group.id);state.applicationRole=db.role(botId,credentials.ownerId);}
  const config={dataDir:directory,botsDir:path.join(directory,'bots'),serviceOwnerId:credentials.ownerId};fs.mkdirSync(path.join(config.botsDir,botId),{recursive:true});
  controller=createTestController();
  save();record({type:'ready',run,username:me.username,membership:member.status,expiresAt:state.expiresAt});
  while(!stop.signal.aborted){
    let updates;try{pollStarted=true;updates=await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:10,allowed_updates:['message']});}catch(error){if(stop.signal.aborted)break;throw error;}
    state.pollCycles++;
    for(const update of updates){await receive(update);offset=update.update_id+1;state.nextOffset=offset;save();if(stop.signal.aborted)break;}
  }
}catch(error){record({type:'fatal',error:clean(error.message)});state.errors.push({error:clean(error.message)});process.exitCode=1;}
finally{
  clearTimeout(timer);clearInterval(watcher);cleaning=true;controller?.close();await controller?.idle();
  for(const backup of [...state.backups].reverse()){
    try{
      await call(backup.commands.length?'setMyCommands':'deleteMyCommands',{...backup.target,...(backup.commands.length?{commands:backup.commands}:{})});
      const actual=await call('getMyCommands',backup.target);if(JSON.stringify(actual)!==JSON.stringify(backup.commands))throw new Error('Command restore read-back mismatch.');backup.restored=true;
    }catch(error){backup.restoreError=clean(error.message);process.exitCode=1;}
  }
  for(const address of privateReceipts.values())try{await call('deleteEphemeralMessage',address);}catch(error){record({type:'output_cleanup_failed',error:clean(error.message)});}
  for(const message_id of ordinaryReceipts)try{await call('deleteMessage',{chat_id:state.groupId,message_id});}catch(error){record({type:'output_cleanup_failed',error:clean(error.message)});}
  if(identity&&pollStarted)try{await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:0,limit:1,allowed_updates:previousAllowed??['message','edited_message','channel_post','edited_channel_post','callback_query','inline_query','guest_message','my_chat_member','message_reaction','message_reaction_count','poll','poll_answer']});}catch(error){record({type:'poll_restore_failed',error:clean(error.message)});}
  db?.close();state.stoppedAt=Date.now();save();release();record({type:'stopped',run,restored:state.backups.every(b=>b.restored),modelCalls:state.modelCalls,lockReleased:true});
}
