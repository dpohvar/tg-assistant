// Bounded opt-in dictionary editor acceptance on the designated test bot only.
// node test/manual/react-dictionary-acceptance.mjs --config PRIVATE_JSON --state-dir NEW_DIR --chat-id GROUP_ID --anchor-message-id MESSAGE_ID
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
import {acquireLock} from "../../src/service/lock.mjs";

const record=(root,event)=>{
  fs.appendFileSync(path.join(root,"events.jsonl"),
    JSON.stringify({at:new Date().toISOString(),...event})+"\n",{mode:0o600});
  console.log(JSON.stringify(event));
};

export async function runReactDictionaryAcceptance(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{
    config:{type:"string"},"state-dir":{type:"string"},"chat-id":{type:"string"},
    "anchor-message-id":{type:"string"},
    "duration-seconds":{type:"string",default:"1200"},
  }});
  if(!values.config||!values["state-dir"]||!values["chat-id"]||
      !values["anchor-message-id"])
    throw Error("Provide --config, a fresh --state-dir, --chat-id, and --anchor-message-id.");
  const duration=Number(values["duration-seconds"]),chatId=Number(values["chat-id"]),
    anchorMessageId=Number(values["anchor-message-id"]);
  if(!Number.isSafeInteger(duration)||duration<60||duration>1800||
      !Number.isSafeInteger(chatId)||chatId>=0||
      !Number.isSafeInteger(anchorMessageId)||anchorMessageId<1)
    throw Error("Invalid duration, group chat ID, or anchor message ID.");
  const configPath=path.resolve(values.config),config=JSON.parse(fs.readFileSync(configPath,"utf8"));
  if(config.controllerActive!==false||config.username!=="dpohvar_test_pub_bot"||
      !Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||
      !(config.token||config.tokenFile)||typeof config.codexExecutable!=="string"||
      !fs.existsSync(config.codexExecutable))
    throw Error("The designated test bot must be offline in this private config.");
  const root=path.resolve(values["state-dir"]);
  if(fs.existsSync(root))throw Error("Use a new state directory.");
  const release=acquireLock(path.join(path.dirname(configPath),"react-wordle-acceptance.lock"));
  const probeId=randomBytes(3).toString("hex"),botId="react-dictionary-acceptance";
  const native=createTelegram({getToken:()=>config.token??fs.readFileSync(config.tokenFile,"utf8").trim()});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000);
  let db,service,widgetId,scope,previousAllowed=[],updatesChanged=false,offset;
  const call=(method,args={})=>native.call(botId,method,args,{
    signal:AbortSignal.timeout(method==="getUpdates"?25_000:20_000)});
  try{
    fs.mkdirSync(root,{recursive:true});
    const me=await call("getMe");
    if(me.id!==config.botTelegramId||me.username!==config.username)
      throw Error("Test bot identity changed.");
    const webhook=await call("getWebhookInfo");
    if(webhook.url)throw Error("Test bot webhook must be disabled for this probe.");
    previousAllowed=webhook.allowed_updates??[];
    const group=await call("getChat",{chat_id:chatId});
    if(!["group","supergroup"].includes(group.type))throw Error("Target is not a group.");
    const member=await call("getChatMember",{chat_id:chatId,user_id:me.id});
    if(["left","kicked"].includes(member.status))
      throw Error("Test bot is absent from the target group.");
    const allowedUpdates=["callback_query","message"];
    const backlog=await call("getUpdates",{offset:-1,timeout:0,
      allowed_updates:allowedUpdates});
    offset=backlog.length?backlog.at(-1).update_id+1:undefined;
    updatesChanged=true;
    const dataDir=path.join(root,"data"),botsDir=path.join(root,"bots");
    db=openDatabase(path.join(root,"controller.sqlite"));
    db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:config.ownerId});
    db.saveChat(botId,group);
    const owner=db.ensureAgent(botId,chatId);
    scope={botId,agentId:owner.agentId,chatId};
    const botRoot=path.join(botsDir,botId),widgetRoot=path.join(botRoot,"widgets","wordle");
    fs.mkdirSync(path.dirname(widgetRoot),{recursive:true});
    fs.cpSync(path.resolve("examples/widgets/wordle"),widgetRoot,{recursive:true});
    const files=new BotFiles(botRoot,owner.agentId);
    const telegram={call:async(id,method,args={},options={})=>{
      if(id!==botId||args.chat_id!==undefined&&args.chat_id!==chatId)
        throw Error("Telegram target outside the acceptance group.");
      const result=await native.call(id,method,args,{...options,signal:AbortSignal.timeout(20_000)});
      if(method.startsWith("send")||method.startsWith("edit"))
        record(root,{type:"telegram",method,messageId:result?.message_id??null,
          replyToMessageId:result?.reply_to_message?.message_id??null});
      return result;
    }};
    service=createWidgetService({db,config:{dataDir,botsDir,
      codexExecutable:config.codexExecutable},telegram,filesFor:()=>files,
      invoke:async()=>{throw Error("Agent tools are disabled in this acceptance.");},
      notify:async(_owner,event)=>{
        record(root,{type:"notification",eventType:event.eventType,
          widgetId:event.widgetId,text:event.text,
          description:String(event.description??"").slice(0,1000)});return "accepted";
      }});
    const route=createWidgetEvents({db,manager:service,telegram});
    const created=await service.create(scope,{handler:"widgets/wordle/dictionary-admin.tsx",
      description:"React Wordle dictionary acceptance "+probeId,
      props:{auditChatId:chatId}});
    widgetId=created.widgetId;
    const editor=await service.setView(scope,{widgetId,component:"Editor",send:{chatId,
      reply_parameters:{message_id:anchorMessageId}}});
    const ready={type:"ready",probeId,widgetId,viewId:editor.viewId,
      messageId:editor.target.messageId,stopCommand:"/dictionary_stop "+probeId};
    record(root,ready);
    while(!abort.signal.aborted&&!fs.existsSync(path.join(root,"stop"))){
      let updates;
      try{updates=await call("getUpdates",{offset,timeout:15,
        allowed_updates:allowedUpdates});}
      catch(error){if(abort.signal.aborted)break;throw error;}
      for(const update of updates){
        offset=update.update_id+1;
        const message=update.message;
        if(message?.chat?.id===chatId&&message.from?.id===config.ownerId&&
            message.text===ready.stopCommand){abort.abort();break;}
        const callback=update.callback_query;
        if(callback?.message?.chat?.id!==chatId)continue;
        const accepted=await route(botId,update);
        if(accepted)record(root,{type:"callback",userId:callback.from?.id,
          callbackId:callback.id});
      }
    }
    return {probeId,widgetId,messageId:editor.target.messageId};
  }finally{
    abort.abort();clearTimeout(timer);
    if(service&&scope&&widgetId)try{
      await service.delete(scope,{widgetId});
      record(root,{type:"retired",probeId});
    }catch(error){record(root,{type:"retire_failed",code:error.code??"unknown"});}
    await service?.idle().catch(()=>{});await service?.close().catch(()=>{});
    if(updatesChanged)try{await call("getUpdates",{offset,timeout:0,
      allowed_updates:previousAllowed});}catch{}
    db?.close();release();
    if(fs.existsSync(root))record(root,{type:"stopped",probeId});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  runReactDictionaryAcceptance().then(result=>console.log(JSON.stringify(result)),
    error=>{console.error(String(error.message??error)
      .replace(/\d{10}:[A-Za-z0-9_-]+/g,"[redacted]").slice(0,1000));process.exitCode=1;});
}
