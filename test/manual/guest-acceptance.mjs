// Explicit bounded real-model/Telegram acceptance. No production DB or config edits.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createTelegram} from '../../src/telegram/api.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {WORDLE_ARCHIVE_SHA,sourceHashes} from '../helpers/wordle-fixture.mjs';
import {fixturePNG} from './inline-fixtures.mjs';
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12);
export function extractGuestArchive(archive,workspace,execute=execFileSync){
  return execute('tar',['-xf',path.basename(archive),'-C',workspace.replaceAll('\\','/')],{cwd:path.dirname(path.resolve(archive)),windowsHide:true});
}
export function guestProbeControl(message,{ownerId,run}){
  if(message?.chat?.type!=='private'||message.chat.id!==message.from?.id||!/^\/guest(?:\s|$)/.test(message.text??''))return null;
  if(message.text===`/guest join ${run}`)return 'join';
  if(message.from.id===ownerId)for(const command of ['stop','restart','later'])if(message.text===`/guest ${command} ${run}`)return command;
  return 'ignore';
}

export function guestAcceptanceGuard({botId,ownerId,run,startedAt=Date.now(),sendBudget=40,editBudget=2048}) {
  const users=new Set([ownerId]),groups=new Set(),queries=new Set(),inline=new Set(),messages=new Set();let sent=0,edited=0;
  return {
    users,groups,allowUser:id=>users.add(id),allowGroup:id=>groups.add(id),allowQuery:id=>queries.add(id),allowInline:id=>inline.add(id),allowMessage:(chat,id)=>messages.add(`${chat}/${id}`),
    accept(update) {
      const guest=update.guest_message;
      if(guest)return Number.isSafeInteger(guest.from?.id)&&guest.from.id>0&&guest.date*1000>=startedAt-5000&&typeof guest.guest_query_id==='string'&&(guest.text??guest.caption??'').includes(`guest ${run}`);
      if(update.callback_query?.inline_message_id)return inline.has(update.callback_query.inline_message_id);
      if(update.my_chat_member)return update.my_chat_member.from?.id===ownerId;
      const m=update.message;
      if(!m)return false;
      if(m.chat?.type==='private')return users.has(m.from?.id)&&m.chat.id===m.from.id;
      return groups.has(m.chat?.id);
    },
    before(bot,method,args={}) {
      if(bot!==botId)throw new Error('Foreign acceptance bot target.');
      if(method==='answerGuestQuery'&&!queries.has(args.guest_query_id))throw new Error('Unobserved guest query target.');
      if(args.chat_id!==undefined&&!users.has(args.chat_id)&&!groups.has(args.chat_id))throw new Error('Foreign ordinary acceptance chat target.');
      if(args.inline_message_id&&!inline.has(args.inline_message_id))throw new Error('Unknown inline acceptance target.');
      if((method.startsWith('edit')||method==='deleteMessage')&&args.message_id&&!messages.has(`${args.chat_id}/${args.message_id}`))throw new Error('Unknown ordinary acceptance message target.');
      if((method==='answerGuestQuery'||method.startsWith('send')&&method!=='sendChatAction')&&++sent>sendBudget||method.startsWith('edit')&&++edited>editBudget)throw new Error('Acceptance effect budget exceeded.');
    },
  };
}

async function nativeRuntime({config:privateConfig,mode,root,archive,signal,report}) {
  const botId='guest-acceptance',run=randomBytes(3).toString('hex'),startedAt=Date.now();
  const config={dataDir:path.join(root,'data'),botsDir:path.join(root,'bots'),codexHome:path.join(root,'codex-home'),codexExecutable:privateConfig.codexExecutable,defaultTimezone:'UTC',defaultModel:privateConfig.model??'gpt-6.1-sol',serviceOwnerId:privateConfig.ownerId};
  const token=privateConfig.token??fs.readFileSync(privateConfig.tokenFile,'utf8').trim(),native=createTelegram({getToken:()=>token});
  const guard=guestAcceptanceGuard({botId,ownerId:privateConfig.ownerId,run,startedAt}),buffers=[],addedGroups=new Set();let cleaning=false;
  const telegram={getToken:native.getToken,call:async(bot,method,args={},options={})=>{
    guard.before(bot,method,args);
    let result;
    try{result=await native.call(bot,method,args,{...options,signal:cleaning?AbortSignal.timeout(15000):AbortSignal.any([signal,options.signal??AbortSignal.timeout(method==='getUpdates'?25000:120000)])});}
    catch(error){report({type:'telegram_error',method,code:error.code??'telegram_failed',description:String(error.message).replaceAll(token,'[redacted]').slice(0,250)});throw error;}
    if(result?.message_id){guard.allowMessage(result.chat?.id??args.chat_id,result.message_id);if(['sendPhoto','sendDocument','sendVideo','sendAnimation','sendAudio','sendVoice'].includes(method))buffers.push({chatId:result.chat?.id??args.chat_id,messageId:result.message_id});}
    if(method==='answerGuestQuery'&&result?.inline_message_id){guard.allowInline(result.inline_message_id);report({type:'guest_confirmed',queryHash:hash(args.guest_query_id),inlineHash:hash(result.inline_message_id),kind:args.result.type});}
    return result;
  }};
  let db,controller,agent,hashes;
  try {
    const me=await telegram.call(botId,'getMe');
    if(me.id!==privateConfig.botTelegramId||me.username!=='dpohvar_test_pub_bot'||!me.supports_guest_queries)throw new Error('Wrong test bot or Guest Mode disabled.');
    if((await telegram.call(botId,'getWebhookInfo')).url)throw new Error('The test bot has an active webhook.');
    fs.mkdirSync(config.codexHome,{recursive:true});
    if(!fs.existsSync(path.join(config.codexHome,'auth.json')))fs.copyFileSync(path.join(privateConfig.codexHome,'auth.json'),path.join(config.codexHome,'auth.json'));
    db=openDatabase(path.join(config.dataDir,'controller.sqlite'));
    if(!db.getBot(botId))db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:privateConfig.ownerId});
    if(db.getBot(botId).telegramId!==me.id||db.getBot(botId).ownerId!==privateConfig.ownerId)throw new Error('Acceptance database identity mismatch.');
    db.saveChat(botId,await telegram.call(botId,'getChat',{chat_id:privateConfig.ownerId}));db.ensureAgent(botId,privateConfig.ownerId,config.defaultModel);
    for(const row of db.sql.prepare("SELECT chatId FROM chats WHERE botId=? AND chatType='private'").all(botId))guard.allowUser(row.chatId);
    for(const row of db.sql.prepare('SELECT inlineMessageId FROM inline_message_owners WHERE botId=?').all(botId))guard.allowInline(row.inlineMessageId);
    const workspace=path.join(config.botsDir,botId);fs.mkdirSync(workspace,{recursive:true});
    if(['widget','activation'].includes(mode)){
      if(!archive||createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==WORDLE_ARCHIVE_SHA)throw new Error('The approved Wordle archive is required.');
      if(!fs.existsSync(path.join(workspace,'widgets')))extractGuestArchive(archive,workspace);
      hashes=sourceHashes(workspace);
    }
    const rules=path.join(config.dataDir,'rules',botId);fs.mkdirSync(rules,{recursive:true});
    fs.writeFileSync(path.join(rules,'AGENTS.md'),`Isolated bounded Guest Mode acceptance. Do not spawn subagents, contact other agents, commit, push or change game source files. Only act on authenticated current events. For guest output use that event's guestRequestId; for callback edits use its exact inlineMessageId. For ordinary member-group events use only the current agent's authorized chat. Personal agent whose current private chat belongs to the bot owner is A; another personal agent is B; ordinary group agent is CHAT. For ordinary guest requests answer briefly using send with guestRequestId and prefix Guest agent A or B. Group replies use CHAT. Explicit hold/silence requests must remain unanswered. Do not send a private substitute for a guest answer.\nCase: ${mode}.\nFor a Wordle request create_widget with handler widgets/wordle/widget.tsx, description Wordle, state {notify:false,inactivityMs:60000}, then set_widget_view with send:{guestRequestId}. The first visible response must be the game, with no intermediate message. Keep source files unchanged. If an owned compatible game already exists, it may receive another view. On a widget game button, the widget handles the event without a model turn.\nFor an activation request in case activation, instead send one Wordle text message with a prepared Start action, group start, permits {"*":null}; action must be self-contained and request attaching unchanged Wordle to the callback's exact inlineMessageId. On that action event perform it.\nFor media requests use a quiet authorized private buffer followed by a guest send with file_sources. A small PNG and JSON fixture are available under .temp/OWNER_AGENT_ID/guest-fixtures when case media is prepared; use the exact paths supplied in the event if needed. Native rich formatting uses rich_help. Never claim an unsuccessful tool call succeeded. Final prose is internal.\n`);
    let tools=0;
    function startController(){
      agent=new CodexAgent({db,config});const nativeRun=agent.run.bind(agent);
      agent.run=async(scope,events,invoke)=>{
        report({type:'model_turn',events:events.map(e=>e.eventType)});
        if(mode==='repeat'){
          for(const event of events.filter(e=>e.eventType==='guest_message')){
            const once=label=>invoke('send',{guestRequestId:event.guestRequestId,text:`Guest repeat ${run}: ${label}`});
            const results=/\brace\b/i.test(event.textPlain??'')?await Promise.all([once('one'),once('two')]):[await once('first'),await once('repeat')];
            report({type:'repeat_results',results:results.map(r=>({error:r.error,inlineHash:r.inlineMessageId?hash(r.inlineMessageId):undefined,description:r.description}))});
          }return;
        }
        return nativeRun(scope,events,async(name,args,threadId)=>{
          if(++tools>100||!['send','read','edit','rich_help','time','user_roles','create_widget','set_widget_view','get_widget','list_widgets','update_widget','delete_widget_view','delete_widget','save_image','download','user_photos'].includes(name))throw new Error('Tool outside bounded guest acceptance scope.');
          report({type:'tool_started',tool:name});try{const result=await invoke(name,args,threadId);report({type:'tool_finished',tool:name,error:result?.error,...(result?.inlineMessageId?{inlineHash:hash(result.inlineMessageId)}:{})});return result;}catch(error){report({type:'tool_failed',tool:name,code:error.code??'tool_failed'});throw error;}
        });
      };
      controller=createController({db,config,telegram,agent,onError:error=>report({type:'controller_error',code:error.code??'controller_failed',description:String(error.message??'').replaceAll(token,'[redacted]').slice(0,200)})});
    }
    startController();await controller.ready;
    if(mode==='media'){
      const owner=db.agent(botId,privateConfig.ownerId),base=path.join('.temp',owner.agentId,'guest-fixtures');fs.mkdirSync(path.join(workspace,base),{recursive:true});
      fs.writeFileSync(path.join(workspace,base,'image.png'),fixturePNG());fs.writeFileSync(path.join(workspace,base,'document.json'),'{"guestAcceptance":true}\n');
      fs.appendFileSync(path.join(rules,'AGENTS.md'),`\nMedia fixture paths: ${path.join(base,'image.png')} and ${path.join(base,'document.json')}. Send buffers privately with disable_notification:true, then read their file IDs before guest publication.\n`);
    }
    report({type:'ready',run,mode,username:me.username,expiresAt:startedAt+600000});
    let offset,lastRequest;
    return {
      async run(){
        while(!signal.aborted){
          let updates;try{updates=await telegram.call(botId,'getUpdates',{offset,timeout:10,allowed_updates:['guest_message','message','callback_query','my_chat_member']});}
          catch(error){if(signal.aborted)break;if(error.code!=='telegram_transport_failed')throw error;continue;}
          for(const update of updates){
            offset=update.update_id+1;if(signal.aborted)break;
            const m=update.message;
            const control=guestProbeControl(m,{ownerId:privateConfig.ownerId,run});
            if(control==='ignore')continue;
            if(control==='join'){
              guard.allowUser(m.from.id);db.setRole(botId,m.from.id,'user');db.saveChat(botId,m.chat);db.ensureAgent(botId,m.from.id,config.defaultModel);report({type:'participant_enrolled'});continue;
            }
            if(!guard.accept(update))continue;
            if(update.my_chat_member&&['member','administrator'].includes(update.my_chat_member.new_chat_member?.status)){
              const chat=update.my_chat_member.chat;guard.allowGroup(chat.id);if(['left','kicked'].includes(update.my_chat_member.old_chat_member?.status))addedGroups.add(chat.id);
            }
            if(m?.from?.id===privateConfig.ownerId&&m.chat?.id===privateConfig.ownerId){
              if(control==='stop')return;
              if(control==='restart'){controller.close();await controller.idle();startController();await controller.ready;report({type:'restarted',retainedRequests:db.sql.prepare('SELECT count(*) n FROM guest_requests').get().n});continue;}
              if(control==='later'&&lastRequest){const scope=controller.lifecycle.scope(db.agent(botId,privateConfig.ownerId));const read=await controller.invoke(scope,'read',{guestRequestId:lastRequest});const result=await controller.invoke(scope,'send',{guestRequestId:lastRequest,text:'Guest answer after restart'});report({type:'later_answer',readOK:Boolean(read.messages[0].guest_query_id),error:result.error,confirmed:Boolean(result.inlineMessageId)});continue;}
            }
            if(update.guest_message){guard.allowQuery(update.guest_message.guest_query_id);report({type:'guest_received',chatType:update.guest_message.chat.type,queryHash:hash(update.guest_message.guest_query_id),hasPersonalAgent:Boolean(db.agent(botId,update.guest_message.from.id))});}
            await controller.receive(botId,update);
            if(update.guest_message?.from?.id===privateConfig.ownerId){const row=db.sql.prepare('SELECT guestRequestId FROM guest_requests WHERE botId=? AND queryId=?').get(botId,update.guest_message.guest_query_id);lastRequest=row?.guestRequestId;}
          }
        }
      },
      async close(){
        cleaning=true;
        for(const row of db.sql.prepare('SELECT viewId,agentId FROM widget_views WHERE botId=?').all(botId)){
          const owner=db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(row.agentId);if(!owner)continue;
          try{await controller.widgets.deleteView(controller.lifecycle.scope(owner),{viewId:row.viewId});}catch(error){report({type:'cleanup_view_failed',code:error.code??'cleanup_failed'});}
        }
        controller.close();await controller.idle();
        for(const chatId of addedGroups)try{await telegram.call(botId,'leaveChat',{chat_id:chatId});}catch{report({type:'cleanup_membership_failed'});}
        for(const item of buffers)try{await telegram.call(botId,'deleteMessage',{chat_id:item.chatId,message_id:item.messageId});}catch{report({type:'cleanup_buffer_failed'});}
        const unchanged=!hashes||JSON.stringify(sourceHashes(workspace))===JSON.stringify(hashes);
        report({type:'stopped',sourceUnchanged:unchanged});db.close();if(!unchanged)throw new Error('Acceptance changed the approved game sources.');
      },
    };
  }catch(error){controller?.close();await controller?.idle();db?.close();throw error;}
}

export async function runGuestAcceptance({argv=process.argv.slice(2),createRuntime=nativeRuntime,signal,log=e=>console.log(JSON.stringify(e))}={}) {
  const {values:v}=parseArgs({args:argv,options:{config:{type:'string'},case:{type:'string',default:'widget'},archive:{type:'string'},'state-dir':{type:'string'},'duration-seconds':{type:'string',default:'600'}}});
  if(!v.config)throw new Error('An explicit private acceptance configuration is required.');
  const config=JSON.parse(fs.readFileSync(v.config,'utf8')),duration=Number(v['duration-seconds']);
  if(config.controllerActive||!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||!config.codexHome||!config.codexExecutable)throw new Error('An inactive designated bot and explicit native-model configuration are required.');
  if(!Number.isSafeInteger(duration)||duration<1||duration>600)throw new Error('Invalid acceptance duration; maximum is 600 seconds.');
  if(!['routing','media','widget','activation','restart','repeat'].includes(v.case))throw new Error('Invalid guest acceptance case.');
  const root=path.resolve(v['state-dir']??path.join(path.dirname(v.config),'guest-'+Date.now()));
  const release=acquireLock(path.join(path.dirname(path.resolve(v.config)),'inline-calibration.lock'));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000),stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  let runtime;
  try{runtime=await createRuntime({config,mode:v.case,root,archive:v.archive,signal:abort.signal,report:e=>log({at:Date.now(),...e})});await runtime.run();}
  finally{abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);try{await runtime?.close();}finally{release();}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  runGuestAcceptance({signal:abort.signal}).catch(error=>{console.error(JSON.stringify({type:'acceptance_failed',code:error.code??'acceptance_failed',description:String(error.message).replace(/bot\d+:[\w-]+/g,'bot[redacted]').slice(0,250)}));process.exitCode=1;});
}
