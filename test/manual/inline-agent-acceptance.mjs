// Explicit, bounded native-model + Telegram acceptance. No production config writes.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {sourceHashes} from '../helpers/wordle-fixture.mjs';
import {agentFailureDiagnostic} from '../../src/codex/diagnostics.mjs';
import {fixturePNG} from './inline-fixtures.mjs';
import {inlinePolicy} from '../../src/inline/contract.mjs';
import {prepareMediaMatrix} from './inline-media-matrix.mjs';
import {shortMessage} from '../../src/telegram/short-message.mjs';

export function acceptanceUpdate(update,{ownerId}){
  const user=update.inline_query?.from??update.callback_query?.from??update.message?.from??update.edited_message?.from??update.message_reaction?.user??update.poll_answer?.user;
  const chat=update.message?.chat??update.edited_message?.chat??update.callback_query?.message?.chat??update.message_reaction?.chat??update.message_reaction_count?.chat??update.poll_answer?.voter_chat;
  return Boolean((user||chat)&&(!user||user.id===ownerId)&&(!chat||chat.id===ownerId));
}

export function acceptanceEffects({botId,ownerId,sends=8,edits=128}){
  const messages=new Set(),inline=new Set();let sent=0,edited=0;
  return {messages,allowMessage:id=>messages.add(id),allowInline:id=>inline.add(id),
    before(bot,method,args){
      if(bot!==botId)throw new Error('Foreign bot target');
      if(args.chat_id!==undefined&&args.chat_id!==ownerId)throw new Error('Foreign chat target');
      if(args.inline_message_id&&!inline.has(args.inline_message_id))throw new Error('Foreign inline target');
      if((method.startsWith('edit')||method==='deleteMessage')&&args.message_id&&!messages.has(args.message_id))throw new Error('Foreign message target');
      if(method.startsWith('send')&&method!=='sendChatAction'&&++sent>sends||method.startsWith('edit')&&++edited>edits)throw new Error('Acceptance effect budget exceeded');
    },
  };
}
async function nativeRuntime({config:privateConfig,mode,root,signal,report}){
  const botId='inline-acceptance',config={dataDir:path.join(root,'data'),botsDir:path.join(root,'bots'),codexHome:path.join(root,'codex-home'),codexExecutable:privateConfig.codexExecutable,defaultTimezone:'UTC',defaultModel:privateConfig.model??'gpt-6.1-sol',serviceOwnerId:privateConfig.ownerId,inline:privateConfig.inline};
  fs.mkdirSync(config.codexHome,{recursive:true});
  if(!fs.existsSync(path.join(config.codexHome,'auth.json')))fs.copyFileSync(path.join(privateConfig.codexHome,'auth.json'),path.join(config.codexHome,'auth.json'));
  const native=createTelegram({getToken:()=>privateConfig.token??fs.readFileSync(privateConfig.tokenFile,'utf8').trim()}),guard=acceptanceEffects({botId,ownerId:privateConfig.ownerId,...(mode==='matrix'?{sends:12}:{})});
  const cursors=new Map(),protectedEdits=new Set();
  const telegram={getToken:native.getToken,call:async(b,method,args={},options)=>{
    guard.before(b,method,args);
    if(method.startsWith('edit')&&protectedEdits.has(args.message_id))throw Object.assign(new Error('Fixture must reject via_bot edits before Telegram.'),{code:'fixture_edit_attempt'});
    if(method==='answerInlineQuery'){
      if(args.next_offset)cursors.set(args.next_offset,Date.now());
      report({type:'answer_started',queryId:args.inline_query_id,nextCursor:args.next_offset,rows:args.results.length,kinds:args.results.map(r=>r.type)});
    }
    let result;try{result=await native.call(b,method,args,options);}catch(error){if(method==='answerInlineQuery')report({type:'answer_failed',queryId:args.inline_query_id,code:error.code??'telegram_failed',description:String(error.message??'').replace(/bot\d+:[\w-]+/g,'bot[redacted]').slice(0,300)});throw error;}
    if(method.startsWith('send')&&result?.message_id)guard.allowMessage(result.message_id);
    if(method==='answerInlineQuery')report({type:'answer',queryId:args.inline_query_id,kinds:args.results.map(r=>r.type),sources:args.results.map(r=>Object.keys(r).some(k=>k.endsWith('_file_id'))?'cached':Object.keys(r).some(k=>k.endsWith('_url'))?'url':'native'),rows:args.results.length,more:Boolean(args.next_offset),labels:args.results.map(r=>r.title).filter(title=>/^(?:⬇️ )?(Scroll to send command \[|Command sent to agent$|Agent is working$)/.test(title??''))});
    return result;
  }};
  const me=await telegram.call(botId,'getMe');if(me.id!==privateConfig.botTelegramId||!me.supports_inline_queries)throw new Error('Designated inline bot identity mismatch');
  if((await telegram.call(botId,'getWebhookInfo')).url)throw new Error('Test bot webhook is active');
  const db=openDatabase(path.join(config.dataDir,'controller.sqlite')),registered=db.getBot(botId);
  if(registered){if(registered.telegramId!==me.id||registered.ownerId!==privateConfig.ownerId)throw new Error('Fixture identity mismatch');}
  else db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:privateConfig.ownerId});
  db.saveChat(botId,await telegram.call(botId,'getChat',{chat_id:privateConfig.ownerId}));const owner=db.ensureAgent(botId,privateConfig.ownerId,config.defaultModel);
  const workspace=path.join(config.botsDir,botId);fs.mkdirSync(workspace,{recursive:true});
  for(const row of db.sql.prepare('SELECT inlineMessageId FROM inline_message_owners WHERE botId=? AND agentId=?').all(botId,owner.agentId))guard.allowInline(row.inlineMessageId);
  for(const row of db.sql.prepare('SELECT messageId FROM widget_views WHERE botId=? AND agentId=? AND chatId=?').all(botId,owner.agentId,privateConfig.ownerId))if(row.messageId)guard.allowMessage(row.messageId);
  if(privateConfig.wordleSource)fs.cpSync(path.join(privateConfig.wordleSource,'widgets'),path.join(workspace,'widgets'),{recursive:true});
  const hashes=privateConfig.wordleSource?sourceHashes(workspace):null;
  const rules=path.join(config.dataDir,'rules',botId);fs.mkdirSync(rules,{recursive:true});
  fs.writeFileSync(path.join(rules,'AGENTS.md'),`This is an isolated bounded live acceptance environment. Never spawn subagents, contact other agents, commit, push or touch anything outside this bot workspace. Only publish in the current private chat or the exact authenticated inlineMessageId from a controller button event. Keep output concise.\nCase: ${mode}.\nFor a Wordle inline request, prepare a card titled Wordle, message text Wordle, with one Start action button (group start, permits {"*":null}). Its self-contained action must tell you to create widgets/wordle/widget.tsx unchanged with notify:false, then attach it to this exact inlineMessageId using set_widget_view. On the button event, do that. Do not modify the archived game files. Games run with native widget callbacks, not model turns.\nFor image requests generate exactly one tiny cat image with the native image tool, save_image in the same JS block, send to the current user privately with disable_notification:true, read the returned outer message, then set_inline_results with its cached photo_file_id and matching file_sources. Never upload directly in inline output.\nFor other requests use set_inline_results explicitly. Native final text is internal. Do not invent successful tool results.\n`);
  if(mode==='background')fs.appendFileSync(path.join(rules,'AGENTS.md'),`\nFor EVERY inline event in this background case, call time, schedule exactly one continuation 30 seconds later, and finish your root turn WITHOUT set_inline_results. The scheduled instruction must include the exact original requestId and tell you to call set_inline_results with one card titled Background ready, message text Background ready, and one repeatable button titled Check restart, permits {"*":null}, action: Edit this exact inlineMessageId to text Button survived restart. Do not schedule from a scheduled event. If set_inline_results returns request_unavailable, the cancellation is expected: finish without sending or retrying. On a button event perform the action through edit.\n`);
  const scheduledTasks=new Set();let schedules=0;
  const agent=new CodexAgent({db,config});let controller;
  const run=agent.run.bind(agent);agent.run=async(scope,events,invoke)=>{
    for(const event of events)if(event.viaBot===me.username)report({type:'via_bot_agent_event',viaBot:event.viaBot,senderPreserved:event.from?.userId===privateConfig.ownerId});
    report({type:'model_turn',events:events.map(e=>e.eventType),inlineRequestIds:events.filter(e=>e.eventType==='inline').map(e=>e.requestId),failures:events.filter(e=>e.error).map(e=>({code:e.error,reason:/memory limit/i.test(e.description??'')?'memory_limit':/heartbeat/i.test(e.description??'')?'heartbeat':undefined}))});
    const response=await run(scope,events,async(name,args,threadId)=>{
      if(!['set_inline_results','rich_help','time','send','read','edit','save_image','list_widgets','get_widget','create_widget','update_widget','set_widget_view','delete_widget_view','delete_widget','widget_event','user_roles','chats','user_photos','schedule'].includes(name))throw new Error('Tool outside acceptance scope');
      if(name==='schedule'&&(mode!=='background'||++schedules>4||args.cron||!args.at||Date.parse(args.at)<=Date.now()||Date.parse(args.at)>Date.now()+60000))throw new Error('Schedule outside bounded acceptance scope');
      report({type:'tool_started',tool:name,...(name==='set_inline_results'?{requestId:args.requestId}:{} )});try{const result=await invoke(name,args,threadId);if(name==='schedule'&&result.taskId)scheduledTasks.add(result.taskId);report({type:'tool_finished',tool:name,error:result?.error,status:result?.status});return result;}catch(error){report({type:'tool_failed',tool:name,code:error.code??'tool_failed'});throw error;}
    });const request=controller.inline.requests.current(botId,privateConfig.ownerId);report({type:'root_completed',inlinePhase:request?.phase,hasResults:request?.hasResults});return response;
  };
  controller=createController({db,config,telegram,agent,onError:e=>report({type:'controller_error',...agentFailureDiagnostic(e)})});
  let offset,viaFixtureId;
  try{
  await controller.ready;
  if(mode==='mixed'){
    const base=path.join('.temp',owner.agentId,'inline-mixed');fs.mkdirSync(path.join(workspace,base),{recursive:true});
    fs.writeFileSync(path.join(workspace,base,'probe.json'),'{"inlineAcceptance":true}\n');
    const scope=controller.lifecycle.scope(owner);
    const photos=[];
    for(const [index,color] of [[40,100,220],[220,70,40],[40,180,90]].entries()){
      const file=`probe-${index+1}.png`;fs.writeFileSync(path.join(workspace,base,file),fixturePNG(color));
      const photo=await controller.invoke(scope,'send',{photo:'attach://fixture',uploads:{fixture:path.join(base,file)},disable_notification:true});
      photos.push({color:['blue','red','green'][index],messageId:photo.messageIds[0]});
    }
    const document=await controller.invoke(scope,'send',{document:'attach://fixture',uploads:{fixture:path.join(base,'probe.json')},disable_notification:true});
    fs.appendFileSync(path.join(rules,'AGENTS.md'),`\nMixed acceptance: available photo outer messages are ${JSON.stringify(photos)}; document outer message is ${document.messageIds[0]}. If the query contains три, несколько or many, include all three distinct cached photos in blue/red/green order; otherwise include only the blue photo. Read the required outer messages and use their actual file IDs and matching file_sources. Submit friendly Text result (plain text), friendly Rich result (rich_message paragraph), native cached Document result and then the selected native cached photo results titled Photo blue/red/green. Four results in the single-photo case; six in the three-photo case. Reuse the existing buffer messages; do not send more buffers or generate images. The controller puts photos on their own final page.\n`);
  }
  if(mode==='matrix'){
    const matrix=await prepareMediaMatrix({controller,db,scope:controller.lifecycle.scope(owner),workspace,assetsDir:privateConfig.mediaAssets,signal});
    fs.appendFileSync(path.join(rules,'AGENTS.md'),`\nMedia matrix acceptance: queries use matrix FAMILY, mixed FAMILY, reverse FAMILY, url FAMILY or cached FAMILY. Family is one of text/photo/gif/mpeg4/video/audio/voice/document/sticker/places. Read the saved outer messages in the selected family's file_sources. For matrix FAMILY submit EXACTLY the corresponding array below. For url FAMILY submit only entries without a native *_file_id field. For cached FAMILY submit only entries with a native *_file_id field. For mixed FAMILY prepend one article {native:{type:"article",id:"mixed-text",title:"TEXT CONTROL",input_message_content:{message_text:"Inline mixed text control"}}} to the exact complete family array. For reverse FAMILY append that article instead. Preserve every selected media variant and its actual fields/file_sources. Use set_inline_results with the original requestId. Do not replace media with text, omit selected variants, generate media, upload, add other results or send buffers. Repeated queries (e.g. mixed gif 2) must submit the same variants for selection. Public URLs are controlled fixtures. Photos are separated by controller policy; all other families should be mixed on one page. Exact family arrays: ${JSON.stringify(matrix.results)}\n`);
    report({type:'matrix_prepared',families:Object.keys(matrix.results),variants:Object.values(matrix.results).flat().length});
    fs.appendFileSync(path.join(rules,'AGENTS.md'),'\nAn ordinary message event containing Native inline article fixture is a controller acceptance card. Receive it silently: no send, edit, set_inline_results or other action is needed. The controller will check its viaBot event and handle /accept via separately.\n');
  }
  let peak=0;const measure=controller.widgets.host.measureTree;
  controller.widgets.host.measureTree=async id=>{const sample=await measure(id);
    if(sample.bytes>peak+1048576){peak=sample.bytes;report({type:'widget_memory',bytes:sample.bytes,processes:sample.processes.map(p=>({pid:p.pid,bytes:p.bytes}))});}
    return sample;
  };
  if(mode==='matrix'){
    const marker=path.join(root,'matrix-rules.sha256'),hash=createHash('sha256').update(fs.readFileSync(path.join(rules,'AGENTS.md'))).digest('hex');
    if(owner.threadId&&(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==hash)){
      // Test-only context refresh; keep the old native rollout and all confirmed buffers/agent data.
      db.sql.prepare('UPDATE agents SET threadId=NULL WHERE botId=? AND agentId=?').run(botId,owner.agentId);
      report({type:'fixture_session_reset',reason:'matrix_instructions_changed'});
    }
    fs.writeFileSync(marker,hash);
  }
  await agent.session(controller.lifecycle.scope(owner),(name,args,threadId)=>controller.invoke({...controller.lifecycle.scope(owner),threadId},name,args));
  const backlog=await native.call(botId,'getUpdates',{offset:-1,timeout:0});
  offset=backlog.at(-1)?.update_id+1;if(!Number.isSafeInteger(offset))offset=undefined;
  }catch(error){report({type:'startup_failed',...agentFailureDiagnostic(error)});await agent.close();controller.close();await controller.idle();db.close();throw error;}
  return {async run(){report({type:'ready',case:mode,botUsername:me.username,policy:inlinePolicy(config.inline),recoveredInlineRequest:Boolean(controller.inline.requests.current(botId,privateConfig.ownerId)),actionDefinitions:db.sql.prepare('SELECT count(*) n FROM inline_buttons WHERE botId=?').get(botId).n});
    while(!signal.aborted&&!fs.existsSync(path.join(root,'stop'))){
      let updates;try{updates=await native.call(botId,'getUpdates',{offset,timeout:15,allowed_updates:['inline_query','callback_query','message','message_reaction','message_reaction_count','poll','poll_answer']},{signal});}catch(error){if(signal.aborted)break;throw error;}
      for(const update of updates){offset=update.update_id+1;if(signal.aborted)break;
        if(update.message?.from?.id===privateConfig.ownerId&&update.message.text==='/accept stop')return;
        if(!acceptanceUpdate(update,{ownerId:privateConfig.ownerId}))continue;
        if(mode==='matrix'&&update.message?.text==='/accept via'){
          try{
            await controller.idle();
            const message=viaFixtureId&&db.getMessage(botId,privateConfig.ownerId,viaFixtureId);
            if(!message?.via_bot||message.via_bot.id!==me.id)throw Object.assign(new Error('Publish the native article in this private chat first.'),{code:'fixture_missing'});
            const scope=controller.lifecycle.scope(owner),edited=await controller.invoke(scope,'edit',{messageId:viaFixtureId,text:'Unexpected fixture edit'});
            report({type:'via_bot_edit',error:edited.error});if(edited.error!=='via_bot_edit_forbidden')throw Object.assign(new Error('Expected the ordinary via_bot edit ban.'),{code:'fixture_edit_not_blocked'});
            const deleted=await controller.invoke(scope,'delete',{messageId:viaFixtureId});report({type:'via_bot_delete',status:deleted.status});viaFixtureId=undefined;
          }catch(error){report({type:'via_bot_probe_failed',code:error.code??'probe_failed'});}
          continue;
        }
        if(update.callback_query?.inline_message_id){const data=update.callback_query.data;if(controller.inline.store.button(botId,data?.slice(2)))guard.allowInline(update.callback_query.inline_message_id);}
        if(mode==='matrix'&&update.message?.via_bot?.id===me.id&&update.message.text==='Native inline article fixture'){
          viaFixtureId=update.message.message_id;guard.allowMessage(viaFixtureId);protectedEdits.add(viaFixtureId);
          report({type:'via_bot_observed',viaBot:shortMessage(update.message).viaBot});
        }
        if(update.message_reaction||update.message_reaction_count)report({type:'inbound_reaction',eventType:update.message_reaction?'message_reaction':'message_reaction_count'});
        if(update.message?.reply_to_message)report({type:'inbound_reply'});
        if(update.inline_query)report({type:'inline_query_received',queryId:update.inline_query.id,cursor:update.inline_query.offset??''});
        if(update.inline_query?.offset)report({type:'pagination_received',queryId:update.inline_query.id,cursor:update.inline_query.offset,intervalMs:Date.now()-(cursors.get(update.inline_query.offset)??Date.now())});
        try{await controller.receive(botId,update);if(update.inline_query&&!update.inline_query.offset)report({type:'initial_query',requestId:controller.inline.requests.current(botId,privateConfig.ownerId)?.requestId});}catch(error){report({type:'receive_failed',code:error.code??'receive_failed'});}
      }
    }
  },async close(){report({type:'closing',inlinePhase:controller.inline.requests.current(botId,privateConfig.ownerId)?.phase,actionDefinitions:db.sql.prepare('SELECT count(*) n FROM inline_buttons WHERE botId=?').get(botId).n});controller.scheduler.cancel(controller.lifecycle.scope(owner),[...scheduledTasks]);controller.close();await agent.close();await controller.idle();
    if(hashes&&JSON.stringify(sourceHashes(workspace))!==JSON.stringify(hashes))report({type:'source_changed'});
    const records=db.sql.prepare('SELECT widgetId,status FROM widgets').all();report({type:'stopped',widgets:records.length});db.close();
  }};
}
export async function runInlineAcceptance({argv=process.argv.slice(2),createRuntime=nativeRuntime,signal,log=e=>console.log(JSON.stringify(e))}={}){
  const {values:v}=parseArgs({args:argv,options:{config:{type:'string'},case:{type:'string',default:'wordle'},'state-dir':{type:'string'},'prompt-rows':{type:'string'},'duration-seconds':{type:'string',default:'600'}}});
  if(!v.config)throw new Error('An explicit private config is required.');
  if(!['wordle','media','background','ownership','mixed','matrix'].includes(v.case))throw new Error('Invalid acceptance case');
  const config=JSON.parse(fs.readFileSync(v.config,'utf8')),duration=Number(v['duration-seconds']);
  if(v['prompt-rows']!==undefined){const overrides={...config.inline,promptRows:Number(v['prompt-rows'])};inlinePolicy(overrides);config.inline=overrides;}
  if(config.controllerActive||!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||!config.codexHome||!config.codexExecutable)throw new Error('Explicit designated bot/model configuration is required');
  if(!Number.isSafeInteger(duration)||duration<1||duration>1800)throw new Error('Invalid duration');
  const root=path.resolve(v['state-dir']??path.join(path.dirname(v.config),'native-'+Date.now()));
  const release=acquireLock(path.join(path.dirname(path.resolve(v.config)),'inline-calibration.lock'));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000),stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  let runtime;try{runtime=await createRuntime({config,mode:v.case,root,signal:abort.signal,report:e=>log({at:Date.now(),...e})});await runtime.run();}
  finally{abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);await runtime?.close();release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  runInlineAcceptance({signal:abort.signal}).catch(error=>{console.error(JSON.stringify({type:'acceptance_failed',code:error.code??'acceptance_failed',message:String(error.message).slice(0,200)}));process.exitCode=1;});
}
