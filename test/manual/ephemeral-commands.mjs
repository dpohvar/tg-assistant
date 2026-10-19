// Opt-in bounded Telegram probe. No model, controller DB, or production configuration.
// node test/manual/ephemeral-commands.mjs PRIVATE_CONFIG [DURATION_SECONDS] [COMPLETED_PROBE_STATE]
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {acquireLock} from '../../src/service/lock.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';

const configFile=path.resolve(process.argv[2]??'');
const seconds=Number(process.argv[3]??1800);
if(!process.argv[2]||!Number.isSafeInteger(seconds)||seconds<30||seconds>1800)throw new Error('Explicit private config and duration 30..1800 seconds required.');
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(config.controllerActive!==false||config.username!=='dpohvar_test_pub_bot'||!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||!config.token)throw new Error('Unsafe test configuration.');
const release=acquireLock(path.join(path.dirname(configFile),'inline-calibration.lock'));
const run=randomBytes(3).toString('hex'),startedAt=Date.now();
const directory=path.resolve('.runtime-check','ephemeral-commands',run);
fs.mkdirSync(directory,{recursive:true});
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12);
const clean=value=>String(value).replaceAll(config.token,'[redacted]').slice(0,400);
const state={run,startedAt,expiresAt:startedAt+seconds*1000,label:'unlabelled',cases:[],replyAttempts:[],backups:[],pollCycles:0};
const save=()=>fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state,null,2),{mode:0o600});
const record=event=>{const line=JSON.stringify({at:Date.now(),...event});fs.appendFileSync(path.join(directory,'events.jsonl'),line+'\n',{mode:0o600});console.log(line);};
const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),seconds*1000);
// Local stop control lets the operator finish gracefully without a Telegram command.
const stopFile=path.join(directory,'stop');
const localStop=setInterval(()=>{if(fs.existsSync(stopFile))stop.abort();},500);
process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
const telegram=createTelegram({getToken:()=>config.token});
let cleaning=false,sends=0,offset,previousAllowed,identityConfirmed=false,pollStarted=false;
const receipts=[];
async function call(method,args={}){
  if(method==='sendMessage'&&++sends>60)throw new Error('Probe send budget exceeded.');
  if(args.chat_id!==undefined&&args.chat_id!==config.ownerId&&args.chat_id!==state.groupId)throw new Error('Unobserved probe chat.');
  return telegram.call('probe',method,args,{signal:cleaning?AbortSignal.timeout(12000):AbortSignal.any([stop.signal,AbortSignal.timeout(method==='getUpdates'?20000:12000)])});
}
const dm=text=>call('sendMessage',{chat_id:config.ownerId,text,disable_notification:true});
async function bind(message){
  if(state.groupId&&state.groupId!==message.chat.id)throw new Error('Probe is already bound to another group.');
  if(state.groupId)return;
  state.groupId=message.chat.id;state.groupType=message.chat.type;save();
  const member=await call('getChatMember',{chat_id:state.groupId,user_id:config.botTelegramId});
  state.botMembership=member.status;
  const commands=[{command:'ephcheck',description:'Private ephemeral command test',is_ephemeral:true},{command:'pubcheck',description:'Public command control',is_ephemeral:false}];
  for(const language_code of new Set(['','ru','en',message.from.language_code?.split('-')[0]].filter(x=>x!==undefined))){
    const target={scope:{type:'chat',chat_id:state.groupId},language_code};
    const previous=await call('getMyCommands',target);
    state.backups.push({target,commands:previous,attempted:true});save();
    await call('setMyCommands',{...target,commands});
    const current=await call('getMyCommands',target);
    if(!current.some(c=>c.command==='ephcheck'&&c.is_ephemeral===true)||!current.some(c=>c.command==='pubcheck'&&!c.is_ephemeral))throw new Error('Telegram did not preserve command flags.');
    record({type:'commands_confirmed',language:language_code||'default',ephemeral:true,control:true});
  }
  save();record({type:'group_ready',run,chatType:state.groupType,chatHash:hash(state.groupId),membership:member.status});
  await dm(`Ephemeral probe ${run}: group ready (${state.groupType}, bot ${member.status}).\nCommands: /ephcheck (private), /pubcheck (public control), /ephunknown (unregistered control).\nCheck Telegram's native visibility labels on commands and replies.\nPrivate controls: /eprobe label desktop | android; /eprobe summary; /eprobe stop ${run}.`);
}
async function receive(update){
  const message=update.message;
  if(!message||message.from?.id!==config.ownerId||message.date*1000<startedAt-5000)return;
  const text=message.text??'';
  if(message.chat?.type==='private'&&message.chat.id===config.ownerId){
    if(text===`/eprobe stop ${run}`){stop.abort();return;}
    if(/^\/eprobe label (desktop|android)$/.test(text)){state.label=text.split(' ').at(-1);save();await dm(`Probe label: ${state.label}`);return;}
    if(text==='/eprobe summary')await dm(`Probe ${run}: ${state.cases.length} commands; ephemeral=${state.cases.filter(c=>c.ephemeral).length}; private replies=${state.cases.filter(c=>c.answer?.ok).length}.\n${state.cases.map(c=>`#${c.number} ${c.label} ${c.text}: ${c.ephemeral?'EPHEMERAL':'ORDINARY'}, reply=${c.answer?.ok??'not attempted'}`).join('\n')}`.slice(0,3900));
    return;
  }
  if(!['group','supergroup'].includes(message.chat?.type))return;
  if(text===`/eprobe_setup@${config.username} ${run}`){await bind(message);return;}
  if(message.chat.id!==state.groupId)return;
  const reply=message.reply_to_message;
  const knownReply=reply?.from?.id===config.botTelegramId&&reply.ephemeral_message_id!==undefined&&receipts.some(r=>r.ephemeral_message_id===reply.ephemeral_message_id);
  if(text===`eph-reply ${run}`||knownReply){
    if(state.replyAttempts.length>=12)return;
    const attempt={receivedAt:Date.now(),message,ephemeral:message.ephemeral_message_id!==undefined,hasReply:!!reply,hasExternalReply:!!message.external_reply,knownReply};
    state.replyAttempts.push(attempt);save();
    record({type:'reply_attempt_received',ephemeral:attempt.ephemeral,hasReply:attempt.hasReply,hasExternalReply:attempt.hasExternalReply,knownReply,messageId:message.message_id,ephemeralId:message.ephemeral_message_id,replyMessageId:reply?.message_id,replyEphemeralId:reply?.ephemeral_message_id,messageKeys:Object.keys(message),replyKeys:reply?Object.keys(reply):[]});
    await dm(`Reply probe ${run}: received ${attempt.ephemeral?'EPHEMERAL':'ORDINARY'} text; reply_to_message=${attempt.hasReply}; external_reply=${attempt.hasExternalReply}; known bot target=${knownReply}.`);
    return;
  }
  if(!/^\/(ephcheck|pubcheck|ephunknown)(?:@dpohvar_test_pub_bot)?(?:\s|$)/i.test(text))return;
  if(state.cases.length>=24)return;
  const entry={number:state.cases.length+1,label:state.label,text,message,receivedAt:Date.now(),ephemeral:message.ephemeral_message_id!==undefined};
  state.cases.push(entry);save();
  record({type:'command_received',number:entry.number,label:entry.label,text,ephemeral:entry.ephemeral,messageId:message.message_id,ephemeralId:message.ephemeral_message_id,hasReceiver:!!message.receiver_user,messageKeys:Object.keys(message),ageMs:Date.now()-message.date*1000});
  if(entry.ephemeral){
    const begin=Date.now();
    try{
      const result=await call('sendMessage',{chat_id:state.groupId,text:`Private receipt #${entry.number} (${entry.label}): ${text}\nReply probe: eph-reply ${run}`,ephemeral_message_parameters:{receiver_user_id:message.from.id},reply_parameters:{ephemeral_message_id:message.ephemeral_message_id}});
      entry.answer={ok:true,elapsedMs:Date.now()-begin,message:result};
      if(result.ephemeral_message_id!==undefined)receipts.push({chat_id:state.groupId,receiver_user_id:message.from.id,ephemeral_message_id:result.ephemeral_message_id});
      record({type:'private_reply',number:entry.number,ok:true,elapsedMs:entry.answer.elapsedMs,messageId:result.message_id,ephemeralId:result.ephemeral_message_id,hasReceiver:!!result.receiver_user});
    }catch(error){entry.answer={ok:false,error:clean(error.message)};record({type:'private_reply',number:entry.number,...entry.answer});}
  }
  save();
  await dm(`Probe #${entry.number} (${entry.label}): ${text}\nReceived as ${entry.ephemeral?'EPHEMERAL':'ORDINARY'}; message_id=${message.message_id}; private reply=${entry.answer?.ok??'not attempted'}.`);
}
try{
  const me=await call('getMe');
  if(me.id!==config.botTelegramId||me.username!==config.username)throw new Error('Wrong test bot.');
  identityConfirmed=true;
  const hook=await call('getWebhookInfo');
  if(hook.url)throw new Error('Test bot has an active webhook.');
  previousAllowed=hook.allowed_updates;
  if(process.argv[4]){
    const previous=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]),'utf8'));
    if(!previous.stoppedAt||!Number.isSafeInteger(previous.groupId)||previous.groupId>=0||!['group','supergroup'].includes(previous.groupType)||!previous.backups?.length||!previous.backups.every(b=>b.restored===true))throw new Error('Explicit completed group probe required for reuse.');
    await bind({chat:{id:previous.groupId,type:previous.groupType},from:{id:config.ownerId,language_code:'en'}});
  }
  save();record({type:'ready',run,username:me.username,expiresAt:state.expiresAt,setup:`/eprobe_setup@${config.username} ${run}`});
  while(!stop.signal.aborted){
    let updates;
    try{pollStarted=true;updates=await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:10,allowed_updates:['message','my_chat_member']});}
    catch(error){if(stop.signal.aborted)break;throw error;}
    state.pollCycles++;
    for(const update of updates){await receive(update);offset=update.update_id+1;state.nextOffset=offset;save();if(stop.signal.aborted)break;}
  }
}catch(error){record({type:'fatal',error:clean(error.message)});process.exitCode=1;}
finally{
  clearTimeout(timer);clearInterval(localStop);cleaning=true;
  for(const backup of [...state.backups].reverse()){
    try{await call(backup.commands.length?'setMyCommands':'deleteMyCommands',{...backup.target,...(backup.commands.length?{commands:backup.commands}:{})});backup.restored=true;}
    catch(error){backup.restoreError=clean(error.message);process.exitCode=1;record({type:'restore_failed',language:backup.target.language_code,error:backup.restoreError});}
  }
  for(const receipt of receipts){try{await call('deleteEphemeralMessage',receipt);}catch(error){record({type:'receipt_cleanup_failed',error:clean(error.message)});}}
  // Restore the controller's normal update inventory if Telegram did not expose the previous setting.
  if(identityConfirmed&&pollStarted)try{await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:0,limit:1,allowed_updates:previousAllowed??['message','edited_message','channel_post','edited_channel_post','callback_query','inline_query','guest_message','my_chat_member','message_reaction','message_reaction_count','poll','poll_answer']});}catch(error){record({type:'poll_cleanup_failed',error:clean(error.message)});}
  state.stoppedAt=Date.now();save();release();record({type:'stopped',run,cases:state.cases.length,commandsRestored:state.backups.every(b=>b.restored===true),lockReleased:true});
}
