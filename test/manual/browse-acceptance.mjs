// Opt-in controller acceptance. No model, production DB, or arbitrary chat routes.
// node test/manual/browse-acceptance.mjs PRIVATE_CONFIG COMPLETED_GROUP_PROBE [SECONDS]
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createTelegram} from '../../src/telegram/api.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {registerGroupCommands} from '../../src/commands/registration.mjs';
import {fixturePNG} from './inline-fixtures.mjs';

if(!process.argv[2]||!process.argv[3])throw new Error('Explicit test credentials and observed group probe required.');
const configFile=path.resolve(process.argv[2]),credentials=JSON.parse(fs.readFileSync(configFile,'utf8'));
const previous=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]),'utf8')),seconds=Number(process.argv[4]??1800);
if(credentials.controllerActive!==false||credentials.username!=='dpohvar_test_pub_bot'||!credentials.token||!Number.isSafeInteger(credentials.ownerId)||!Number.isSafeInteger(credentials.botTelegramId))throw new Error('Unsafe test configuration.');
if(!previous.stoppedAt||!Number.isSafeInteger(previous.groupId)||previous.groupId>=0||!['group','supergroup'].includes(previous.groupType)||!previous.backups?.length||!previous.backups.every(b=>b.restored))throw new Error('A completed observed group probe is required.');
if(!Number.isSafeInteger(seconds)||seconds<30||seconds>1800)throw new Error('Duration must be 30..1800 seconds.');
const release=acquireLock(path.join(path.dirname(configFile),'inline-calibration.lock'));
const run=randomBytes(4).toString('hex'),directory=path.resolve('.runtime-check','browse-acceptance',run),botId='browse-acceptance';
fs.mkdirSync(directory,{recursive:true});
const state={run,pid:process.pid,startedAt:Date.now(),expiresAt:Date.now()+seconds*1000,username:credentials.username,groupId:previous.groupId,backups:[],inputs:0,callbacks:0,errors:[],modelCalls:0};
const save=()=>fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state,null,2),{mode:0o600});
const clean=text=>String(text).replaceAll(credentials.token,'[redacted]').slice(0,500);
const record=event=>{const line=JSON.stringify({at:Date.now(),...event});fs.appendFileSync(path.join(directory,'events.jsonl'),line+'\n',{mode:0o600});console.log(line);};
const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),seconds*1000),jobs=new Set();
const watcher=setInterval(()=>{if(fs.existsSync(path.join(directory,'stop')))abort.abort();},500);
process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
const base=createTelegram({getToken:()=>credentials.token}),receipts=new Map();
let db,controller,offset,previousAllowed,pollStarted=false,cleaning=false,sends=0,edits=0;
async function call(method,args={},options={}){
  if(args.chat_id!==undefined&&![credentials.ownerId,state.groupId].includes(args.chat_id))throw new Error('Unobserved test destination.');
  if(method.startsWith('send')&&++sends>300)throw new Error('Acceptance send budget exceeded.');
  if(method.startsWith('edit')&&++edits>1500)throw new Error('Acceptance edit budget exceeded.');
  const result=await base.call(botId,method,args,{...options,signal:AbortSignal.any([cleaning?AbortSignal.timeout(15000):abort.signal,options.signal??AbortSignal.timeout(method==='getUpdates'?20000:120000)])});
  if(method==='deleteEphemeralMessage')receipts.delete(`e:${args.chat_id}:${args.receiver_user_id}:${args.ephemeral_message_id}`);
  if(method==='deleteMessage')receipts.delete(`m:${args.chat_id}:${args.message_id}`);
  if(method.startsWith('send')&&result?.chat){
    const privateRoute=result.ephemeral_message_id!==undefined;
    const key=privateRoute?`e:${result.chat.id}:${result.receiver_user.id}:${result.ephemeral_message_id}`:`m:${result.chat.id}:${result.message_id}`;
    receipts.set(key,{chat_id:result.chat.id,...(privateRoute?{ephemeral_message_id:result.ephemeral_message_id,receiver_user_id:result.receiver_user.id}:{message_id:result.message_id})});
  }
  if(/^(sendRich|edit.*Text|sendDocument)/.test(method))record({type:'output',method,private:!!args.ephemeral_message_parameters||method.startsWith('editEphemeral'),mediaUploads:options.uploads?.length??0});
  return result;
}
const telegram={getToken:base.getToken,call:(_bot,...args)=>call(...args)};
const config={dataDir:directory,botsDir:path.join(directory,'bots'),serviceOwnerId:credentials.ownerId};
const errors=error=>{const entry={at:Date.now(),message:clean(error.message)};state.errors.push(entry);save();record({type:'controller_error',...entry});};

async function receive(update){
  const actor=update.message?.from??update.callback_query?.from,m=update.message??update.callback_query?.message;
  if(actor?.id!==credentials.ownerId||!m||![credentials.ownerId,state.groupId].includes(m.chat?.id))return;
  if(update.message&&m.date*1000<state.startedAt-5000)return;
  if(update.message?.text===`/baccept stop ${run}`){abort.abort();return;}
  if(update.callback_query){if(!update.callback_query.data?.startsWith('br:'))return;state.callbacks++;}
  else if(!m.document&&!/^\/(browse|ls|help)(?:@dpohvar_test_pub_bot)?(?:\s|$)/i.test(m.text??''))return;
  if(++state.inputs>500)throw new Error('Acceptance input budget exceeded.');
  save();record({type:'input',callback:!!update.callback_query,private:m.ephemeral_message_id!==undefined,document:!!m.document});
  await controller.receive(botId,update);
}

try{
  const me=await call('getMe');if(me.id!==credentials.botTelegramId||me.username!==credentials.username)throw new Error('Wrong test bot.');
  const hook=await call('getWebhookInfo');if(hook.url)throw new Error('Active webhook; will not replace it.');previousAllowed=hook.allowed_updates;
  const group=await call('getChat',{chat_id:state.groupId}),membership=await call('getChatMember',{chat_id:state.groupId,user_id:me.id});
  if(!['member','administrator','creator'].includes(membership.status))throw new Error('Test bot is not a member of the observed group.');
  state.groupTitle=group.title;state.groupType=group.type;state.membership=membership.status;
  for(const type of ['all_group_chats','all_chat_administrators'])for(const language_code of ['','en','ru']){
    const target={scope:{type},language_code},commands=await call('getMyCommands',target);state.backups.push({target,commands});save();
  }
  await registerGroupCommands({telegram,botId});
  for(const backup of state.backups){const commands=await call('getMyCommands',backup.target);if(!commands.some(c=>c.command==='browse'&&c.is_ephemeral))throw new Error('Browse command registration failed.');}
  db=openDatabase(path.join(directory,'controller.sqlite'));db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:me.id});db.setRole(botId,credentials.ownerId,'admin');db.saveChat(botId,group);
  const ownerChat=await call('getChat',{chat_id:credentials.ownerId});db.saveChat(botId,ownerChat);
  const root=path.join(config.botsDir,botId);fs.mkdirSync(path.join(root,'wiki','pages'),{recursive:true});fs.mkdirSync(path.join(root,'target','wiki'),{recursive:true});
  fs.writeFileSync(path.join(root,'wiki','sample.py'),'#!/usr/bin/env python3\nprint("Hello from browse")\n');
  fs.writeFileSync(path.join(root,'wiki','long-lines.txt'),Array.from({length:60},(_,i)=>`Line ${i+1}`).join('\n'));
  fs.writeFileSync(path.join(root,'wiki','too-large.txt'),'No preview above 2048 bytes.\n'.repeat(150));
  fs.writeFileSync(path.join(root,'wiki','image.png'),fixturePNG());fs.writeFileSync(path.join(root,'wiki','broken.jpg'),Buffer.from([255,216,255,0]));
  fs.writeFileSync(path.join(root,'target','wiki','sample.py'),'Existing target; merge must ask before replacement.\n');
  fs.writeFileSync(path.join(root,'target','wiki','keep.txt'),'This file must survive a directory merge.\n');
  for(let i=1;i<=24;i++)fs.writeFileSync(path.join(root,'wiki','pages',`file-${String(i).padStart(2,'0')}.txt`),`Pagination fixture ${i}\n`);
  controller=createController({db,config,telegram,fileSignal:abort.signal,onError:errors,agent:{run:async()=>{state.modelCalls++;save();throw new Error('Model turns are not allowed in this acceptance.');},models:async()=>[]}});
  await controller.ready;state.readyAt=Date.now();save();record({type:'ready',run,username:me.username,groupTitle:group.title,expiresAt:state.expiresAt,stateFile:path.join(directory,'state.json')});
  await call('sendMessage',{chat_id:credentials.ownerId,text:`Browse test ${run} is ready for 30 minutes.\nUse /browse here or /browse@${me.username} in ${group.title}.\nFixtures: wiki (text, image, pagination), target (merge conflicts). All files are disposable.\nStop: /baccept stop ${run}`,disable_notification:true});
  while(!abort.signal.aborted){
    let updates;try{pollStarted=true;updates=await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:10,allowed_updates:['message','callback_query']});}catch(error){if(abort.signal.aborted)break;throw error;}
    for(const update of updates){
      const task=receive(update).catch(errors);jobs.add(task);task.finally(()=>jobs.delete(task));offset=update.update_id+1;state.nextOffset=offset;
    }
    save();
  }
}catch(error){errors(error);process.exitCode=1;}
finally{
  clearTimeout(timer);clearInterval(watcher);controller?.close();await Promise.allSettled([...jobs]);await controller?.idle();cleaning=true;
  for(const backup of [...state.backups].reverse())try{
    await call(backup.commands.length?'setMyCommands':'deleteMyCommands',{...backup.target,...(backup.commands.length?{commands:backup.commands}:{})});
    const actual=await call('getMyCommands',backup.target);if(JSON.stringify(actual)!==JSON.stringify(backup.commands))throw new Error('Command restore mismatch.');backup.restored=true;
  }catch(error){backup.error=clean(error.message);process.exitCode=1;}
  for(const a of receipts.values())try{await call(a.ephemeral_message_id?'deleteEphemeralMessage':'deleteMessage',a);}catch(error){record({type:'cleanup_failed',error:clean(error.message)});}
  if(pollStarted)try{await call('getUpdates',{...(offset===undefined?{}:{offset}),timeout:0,limit:1,allowed_updates:previousAllowed??['message','edited_message','channel_post','edited_channel_post','callback_query','inline_query','guest_message','my_chat_member','message_reaction','message_reaction_count','poll','poll_answer']});}catch(error){record({type:'poll_restore_failed',error:clean(error.message)});}
  db?.close();state.stoppedAt=Date.now();save();release();record({type:'stopped',run,restored:state.backups.every(b=>b.restored),modelCalls:state.modelCalls});
}
