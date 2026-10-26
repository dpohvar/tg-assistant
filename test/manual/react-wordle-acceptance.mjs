// Bounded opt-in Wordle acceptance on the designated test bot only.
// node test/manual/react-wordle-acceptance.mjs --config PRIVATE_JSON --state-dir NEW_DIR --chat-id GROUP_ID
import fs from "node:fs";
import path from "node:path";
import {parseArgs} from "node:util";
import {randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {createTelegram} from "../../src/telegram/api.mjs";
import {openDatabase} from "../../src/storage/database.mjs";
import {BotFiles} from "../../src/files/paths.mjs";
import {createWidgetService} from "../../src/widgets/service.mjs";
import {createWidgetEvents} from "../../src/widgets/events.mjs";
import {createInlineStore} from "../../src/inline/store.mjs";
import {acquireLock} from "../../src/service/lock.mjs";

const record=(root,event)=>{
  fs.appendFileSync(path.join(root,"events.jsonl"),
    JSON.stringify({at:new Date().toISOString(),...event})+"\n",{mode:0o600});
  console.log(JSON.stringify(event));
};

export async function runReactWordleAcceptance(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{
    config:{type:"string"},"state-dir":{type:"string"},"chat-id":{type:"string"},
    "duration-seconds":{type:"string",default:"1200"},
  }});
  if(!values.config||!values["state-dir"]||!values["chat-id"])
    throw Error("Provide --config, a fresh --state-dir, and --chat-id of the test group.");
  const duration=Number(values["duration-seconds"]),chatId=Number(values["chat-id"]);
  if(!Number.isSafeInteger(duration)||duration<60||duration>1800||
      !Number.isSafeInteger(chatId)||chatId>=0)throw Error("Invalid duration or group chat ID.");
  const configPath=path.resolve(values.config),config=JSON.parse(fs.readFileSync(configPath,"utf8"));
  if(config.controllerActive!==false||config.username!=="dpohvar_test_pub_bot"||
      !Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||
      !(config.token||config.tokenFile)||typeof config.codexExecutable!=="string"||
      !fs.existsSync(config.codexExecutable))
    throw Error("The designated test bot must be offline in this private config.");
  const root=path.resolve(values["state-dir"]);
  if(fs.existsSync(root))throw Error("Use a new state directory.");
  const release=acquireLock(path.join(path.dirname(configPath),"react-wordle-acceptance.lock"));
  const botId="react-wordle-acceptance",probeId=randomBytes(3).toString("hex");
  const native=createTelegram({getToken:()=>config.token??fs.readFileSync(config.tokenFile,"utf8").trim()});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000);
  let db,service,active,inlineActive,previousAllowed=[],updatesChanged=false,offset,
    finished=false,inlineFinished=false;
  const call=(method,args={})=>native.call(botId,method,args,{
    signal:AbortSignal.timeout(method==="getUpdates"?25_000:20_000)});
  try{
    fs.mkdirSync(root,{recursive:true});
    const me=await call("getMe");
    if(me.id!==config.botTelegramId||me.username!==config.username||
        !me.supports_inline_queries)
      throw Error("Test bot identity changed.");
    const webhook=await call("getWebhookInfo");
    if(webhook.url)throw Error("Test bot webhook must be disabled for this probe.");
    previousAllowed=webhook.allowed_updates??[];
    const group=await call("getChat",{chat_id:chatId});
    if(!["group","supergroup"].includes(group.type))throw Error("Target is not a group.");
    const member=await call("getChatMember",{chat_id:chatId,user_id:me.id});
    if(["left","kicked"].includes(member.status))throw Error("Test bot is absent from the target group.");
    const allowedUpdates=["callback_query","message","inline_query"];
    const backlog=await call("getUpdates",{offset:-1,timeout:0,
      allowed_updates:allowedUpdates});
    offset=backlog.length?backlog.at(-1).update_id+1:undefined;
    updatesChanged=true;
    const dataDir=path.join(root,"data"),botsDir=path.join(root,"bots");
    db=openDatabase(path.join(root,"controller.sqlite"));
    const inlineStore=createInlineStore(db);
    db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:config.ownerId});
    db.saveChat(botId,group);
    const owner=db.ensureAgent(botId,chatId),scope={botId,agentId:owner.agentId,chatId};
    const botRoot=path.join(botsDir,botId),widgetRoot=path.join(botRoot,"widgets","wordle");
    fs.mkdirSync(path.dirname(widgetRoot),{recursive:true});
    fs.cpSync(path.resolve("examples/widgets/wordle"),widgetRoot,{recursive:true});
    const files=new BotFiles(botRoot,owner.agentId);
    const telegram={call:async(id,method,args={},options={})=>{
      if(id!==botId||args.chat_id!==undefined&&args.chat_id!==chatId)
        throw Error("Telegram target outside the acceptance group.");
      const result=await native.call(id,method,args,{...options,signal:AbortSignal.timeout(20_000)});
      if(method.startsWith("send")||method.startsWith("edit")||
          method==="deleteEphemeralMessage")
        record(root,{type:"telegram",method,messageId:result?.message_id??null,
          ephemeralMessageId:result?.ephemeral_message_id??null});
      return result;
    }};
    service=createWidgetService({db,config:{dataDir,botsDir,
      codexExecutable:config.codexExecutable},telegram,filesFor:()=>files,inlineStore,
      invoke:async()=>{throw Error("Agent tools are disabled in this acceptance.");},
      notify:async(_owner,event)=>{
        record(root,{type:"notification",eventType:event.eventType,
          widgetId:event.widgetId,text:event.text,
          description:String(event.description??"")
            .replace(/\d{10}:[A-Za-z0-9_-]+/g,"[redacted]").slice(0,1000)});return "accepted";
      }});
    const route=createWidgetEvents({db,manager:service,telegram});
    const created=await service.create(scope,{handler:"widgets/wordle/widget.tsx",
      description:"React Wordle acceptance "+probeId,
      props:{title:"Wordle · проверка "+probeId,length:5,wordMode:"shared",notify:true}});
    active={scope,widgetId:created.widgetId};
    const players=await service.setView(scope,{widgetId:created.widgetId,
      component:"Players",send:{chatId}});
    const input=await service.setView(scope,{widgetId:created.widgetId,
      component:"GameInput",send:{chatId,
        reply_parameters:{message_id:players.target.messageId}}});
    const inlineWidget=await service.create(scope,{handler:"widgets/wordle/widget.tsx",
      description:"React Wordle inline acceptance "+probeId,
      props:{title:"Wordle · inline "+probeId,length:5,wordMode:"individual"}});
    inlineActive={scope,widgetId:inlineWidget.widgetId};
    const inlineQuery="wordle "+probeId,connectData="wordle-connect:"+probeId;
    const inlineResult={type:"article",id:"wordle-"+probeId,
      title:"Wordle · inline "+probeId,
      description:"Разместите сообщение и нажмите «Подключить игру»",
      input_message_content:{rich_message:{blocks:[{type:"paragraph",
        text:"Wordle · inline "+probeId+". Нажмите «Подключить игру»."}]}},
      reply_markup:{inline_keyboard:[[{text:"Подключить игру",callback_data:connectData}]]}};
    const ready={type:"ready",probeId,widgetId:created.widgetId,
      playersMessageId:players.target.messageId,inputMessageId:input.target.messageId,
      inlineQuery,inlineWidgetId:inlineWidget.widgetId,
      finishCommand:"/wordle_finish "+probeId,stopCommand:"/wordle_stop "+probeId};
    record(root,ready);
    while(!abort.signal.aborted&&!fs.existsSync(path.join(root,"stop"))){
      let updates;
      try{updates=await call("getUpdates",{offset,timeout:15,
        allowed_updates:allowedUpdates});}
      catch(error){if(abort.signal.aborted)break;throw error;}
      for(const update of updates){
        offset=update.update_id+1;
        const inlineQueryUpdate=update.inline_query;
        if(inlineQueryUpdate){
          await call("answerInlineQuery",{inline_query_id:inlineQueryUpdate.id,
            results:inlineQueryUpdate.from?.id===config.ownerId&&
              inlineQueryUpdate.query?.trim()===inlineQuery?[inlineResult]:[],
            next_offset:"",cache_time:0,is_personal:true});
          if(inlineQueryUpdate.query?.trim()===inlineQuery)
            record(root,{type:"inline_query",userId:inlineQueryUpdate.from?.id});
          continue;
        }
        const message=update.message;
        if(message?.chat?.id===chatId&&message.from?.id===config.ownerId){
          if(message.text===ready.finishCommand&&!finished){
            const state=structuredClone(service.store.get(created.widgetId).state);
            state.round.status="finished";state.round.finishedAt=Date.now();
            await service.updateStore(scope,{widgetId:created.widgetId,state});
            await service.idle();finished=true;record(root,{type:"finished",probeId});
          }
          if(message.text===ready.stopCommand){abort.abort();break;}
        }
        const callback=update.callback_query;
        if(callback?.data===connectData){
          if(callback.from?.id!==config.ownerId||!callback.inline_message_id){
            await call("answerCallbackQuery",{callback_query_id:callback.id,
              text:"Подключение доступно автору теста."});
            continue;
          }
          await call("answerCallbackQuery",{callback_query_id:callback.id,
            text:"Подключаю игру…"});
          if(service.store.byTarget(botId,{inlineMessageId:callback.inline_message_id})){
            record(root,{type:"inline_connect_duplicate"});continue;
          }
          inlineStore.claimOwner(scope,callback.inline_message_id);
          try{
            const result=await service.setView(scope,{widgetId:inlineWidget.widgetId,
              component:"GameShared",target:{inlineMessageId:callback.inline_message_id}});
            record(root,{type:"inline_connected",viewId:result.viewId,
              status:result.status??"active"});
          }catch(error){record(root,{type:"inline_connect_failed",
            code:error.code??"unknown",description:String(error.message).slice(0,500)});}
          continue;
        }
        if(callback?.message?.chat?.id!==chatId&&!callback?.inline_message_id)continue;
        const accepted=await route(botId,update);
        if(accepted)record(root,{type:"callback",userId:update.callback_query.from?.id,
          callbackId:update.callback_query.id});
      }
    }
    return {probeId,finished,widgetId:created.widgetId,
      playersMessageId:players.target.messageId,inputMessageId:input.target.messageId};
  }finally{
    abort.abort();clearTimeout(timer);
    if(service&&active&&!finished)try{
      const state=structuredClone(service.store.get(active.widgetId).state);
      if(state.round?.status==="open"){
        state.round.status="finished";state.round.finishedAt=Date.now();
        await service.updateStore(active.scope,{widgetId:active.widgetId,state});
        finished=true;record(root,{type:"finished_on_exit",probeId});
      }
    }catch(error){record(root,{type:"finish_failed",code:error.code??"unknown"});}
    if(service&&inlineActive&&!inlineFinished)try{
      const state=structuredClone(service.store.get(inlineActive.widgetId).state);
      if(state.round?.status==="open"){
        state.round.status="finished";state.round.finishedAt=Date.now();
        await service.updateStore(inlineActive.scope,{widgetId:inlineActive.widgetId,state});
        inlineFinished=true;record(root,{type:"inline_finished_on_exit",probeId});
      }
    }catch(error){record(root,{type:"inline_finish_failed",code:error.code??"unknown"});}
    await service?.idle().catch(()=>{});await service?.close().catch(()=>{});
    if(updatesChanged)try{await call("getUpdates",{offset,timeout:0,
      allowed_updates:previousAllowed});}catch{}
    db?.close();release();
    if(fs.existsSync(root))record(root,{type:"stopped",probeId,finished});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  runReactWordleAcceptance().then(result=>console.log(JSON.stringify(result)),
    error=>{console.error(String(error.message??error)
      .replace(/\d{10}:[A-Za-z0-9_-]+/g,"[redacted]").slice(0,1000));process.exitCode=1;});
}
