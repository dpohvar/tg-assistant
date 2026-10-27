// Bounded live check of one recipient-only Wordle message in test-gr2.
// node test/manual/react-wordle-hidden-acceptance.mjs --config PRIVATE_JSON --state-dir NEW_DIR
// Add --wait-command to publish only after the owner sends the printed ephemeral /say command.
// This observes Telegram command delivery, then mounts directly; it does not exercise the agent queue.
import fs from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {parseArgs} from "node:util";
import {createTelegram} from "../../src/telegram/api.mjs";
import {openDatabase} from "../../src/storage/database.mjs";
import {BotFiles} from "../../src/files/paths.mjs";
import {createWidgetService} from "../../src/widgets/service.mjs";
import {createWidgetEvents} from "../../src/widgets/events.mjs";
import {createInlineStore} from "../../src/inline/store.mjs";
import {acquireLock} from "../../src/service/lock.mjs";

const groupId=-1004392927400;
const emit=(root,event)=>{
  fs.appendFileSync(path.join(root,"events.jsonl"),
    JSON.stringify({at:new Date().toISOString(),...event})+"\n",{mode:0o600});
  console.log(JSON.stringify(event));
};

export async function run(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{
    config:{type:"string"},"state-dir":{type:"string"},
    "duration-seconds":{type:"string",default:"600"},
    "wait-command":{type:"boolean",default:false},
  }});
  const duration=Number(values["duration-seconds"]);
  if(!values.config||!values["state-dir"]||!Number.isSafeInteger(duration)||
      duration<60||duration>1200)throw Error("Provide config, fresh state dir, and 60-1200 seconds.");
  const configPath=path.resolve(values.config),config=JSON.parse(fs.readFileSync(configPath,"utf8"));
  if(config.controllerActive!==false||config.username!=="dpohvar_test_pub_bot"||
      config.botTelegramId!==8768223629||!Number.isSafeInteger(config.ownerId)||
      !(config.token||config.tokenFile)||!fs.existsSync(config.codexExecutable))
    throw Error("The designated test bot must be offline in this private config.");
  const root=path.resolve(values["state-dir"]);
  if(fs.existsSync(root))throw Error("Use a new state directory.");
  const release=acquireLock(path.join(path.dirname(configPath),"react-wordle-acceptance.lock"));
  const botId="react-wordle-solo-acceptance",probeId=randomBytes(3).toString("hex");
  const native=createTelegram({getToken:()=>config.token??fs.readFileSync(config.tokenFile,"utf8").trim()});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000);
  const call=(method,args={})=>native.call(botId,method,args,{
    signal:AbortSignal.timeout(method==="getUpdates"?25_000:20_000)});
  let db,service,hiddenWidget,hidden,previousAllowed=[],updatesChanged=false,offset;
  try{
    const me=await call("getMe");
    if(me.id!==config.botTelegramId||
        ![config.username,"test_dpohvar_app"].includes(me.username))
      throw Error("Test bot identity changed.");
    const webhook=await call("getWebhookInfo");
    if(webhook.url)throw Error("Test bot webhook must be disabled.");
    previousAllowed=webhook.allowed_updates??[];
    const group=await call("getChat",{chat_id:groupId});
    if(group.title!=="test-gr2"||group.type!=="supergroup")
      throw Error("The target is not test-gr2.");
    const member=await call("getChatMember",{chat_id:groupId,user_id:me.id});
    if(!["administrator","creator"].includes(member.status))
      throw Error("Test bot must be an administrator in test-gr2 for proactive hidden sends.");
    const allowedUpdates=values["wait-command"]?["callback_query","message"]:
      ["callback_query"];
    const backlog=await call("getUpdates",{offset:-1,timeout:0,
      allowed_updates:allowedUpdates});
    offset=backlog.length?backlog.at(-1).update_id+1:undefined;
    updatesChanged=true;

    fs.mkdirSync(root,{recursive:true});
    const dataDir=path.join(root,"data"),botsDir=path.join(root,"bots");
    db=openDatabase(path.join(root,"controller.sqlite"));
    db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:config.ownerId});
    db.saveChat(botId,group);
    const groupAgent=db.ensureAgent(botId,groupId);
    const groupScope={botId,agentId:groupAgent.agentId,chatId:groupId};
    const botRoot=path.join(botsDir,botId),widgetRoot=path.join(botRoot,"widgets","wordle");
    fs.mkdirSync(path.dirname(widgetRoot),{recursive:true});
    fs.cpSync(path.resolve("examples/widgets/wordle"),widgetRoot,{recursive:true});
    const groupFiles=new BotFiles(botRoot,groupAgent.agentId);
    const telegram={call:async(id,method,args={},options={})=>{
      if(id!==botId||args.chat_id!==undefined&&args.chat_id!==groupId)
        throw Error("Telegram target outside test-gr2.");
      return native.call(id,method,args,{...options,signal:AbortSignal.timeout(20_000)});
    }};
    service=createWidgetService({db,config:{dataDir,botsDir,
      codexExecutable:config.codexExecutable},telegram,
      filesFor:()=>groupFiles,
      inlineStore:createInlineStore(db),
      invoke:async()=>{throw Error("Agent tools are disabled in this acceptance.");},
      notify:async(_owner,event)=>{
        emit(root,{type:"notification",eventType:event.eventType,
          code:event.code??null,widgetId:event.widgetId??null});return "accepted";
      }});
    const route=createWidgetEvents({db,manager:service,telegram});
    const mountHidden=async()=>{
      const created=await service.create(groupScope,{handler:"widgets/wordle/widget.tsx",
        description:"Hidden group Wordle acceptance "+probeId,
        props:{title:"Wordle · скрытая игра · "+probeId,
          length:5,wordMode:"individual"}});
      hiddenWidget={scope:groupScope,id:created.widgetId};
      hidden=await service.setView(groupScope,{widgetId:hiddenWidget.id,
        component:"GameInput",target:{chatId:groupId,receiverUserId:config.ownerId}});
      emit(root,{type:"ready",probeId,ephemeralMessageId:hidden.target.ephemeralMessageId,
        widgetId:hiddenWidget.id,viewId:hidden.viewId});
    };
    const command="/say wordle "+probeId;
    if(values["wait-command"])emit(root,{type:"waiting",probeId,command});
    else await mountHidden();

    while(!abort.signal.aborted&&!fs.existsSync(path.join(root,"stop"))){
      let updates;
      try{updates=await call("getUpdates",{offset,timeout:15,
        allowed_updates:allowedUpdates});}
      catch(error){if(abort.signal.aborted)break;throw error;}
      for(const update of updates){
        offset=update.update_id+1;
        if(values["wait-command"]&&!update.message)
          emit(root,{type:"observed_update",probeId,
            updateTypes:Object.keys(update).filter(key=>key!=="update_id")});
        const message=update.message;
        if(values["wait-command"]&&message?.chat?.id===groupId)
          emit(root,{type:"observed_message",probeId,
            fromId:message.from?.id??null,senderChatId:message.sender_chat?.id??null,
            ephemeralMessageId:message.ephemeral_message_id??null,
            textMatches:message.text===command,
            textPrefix:typeof message.text==="string"?message.text.slice(0,12):null});
        if(!hidden&&values["wait-command"]&&message?.chat?.id===groupId&&
            message.from?.id===config.ownerId&&
            Number.isSafeInteger(message.ephemeral_message_id)&&message.text===command){
          emit(root,{type:"ephemeral_command",probeId,
            ephemeralMessageId:message.ephemeral_message_id});
          await mountHidden();
          continue;
        }
        const callback=update.callback_query;
        if(!hidden||callback?.message?.chat?.id!==groupId||
            callback.message.ephemeral_message_id!==hidden.target.ephemeralMessageId)continue;
        const accepted=await route(botId,update);
        if(accepted){await service.idle();
          emit(root,{type:"callback",fromId:callback.from?.id,
            input:service.store.get(hiddenWidget.id)?.state?.players?.
              [String(config.ownerId)]?.input??"",
            viewCount:service.store.listViews(hiddenWidget.id).length});}
      }
    }
  }finally{
    abort.abort();clearTimeout(timer);
    for(const widget of [hiddenWidget])if(service&&widget)try{
      if(service.store.get(widget.id)?.state?.round?.status==="open"){
        const result=await service.dispatchAction(widget.scope,{widgetId:widget.id,
          action:"finishRound"});
        emit(root,{type:"finished",widgetId:widget.id,
          updatedViews:result.updatedViews,failedViews:result.failedViews});
      }
    }catch(error){emit(root,{type:"finish_failed",widgetId:widget.id,
      code:error.code??"unknown",description:String(error.message).slice(0,300)});}
    await service?.idle().catch(()=>{});await service?.close().catch(()=>{});
    if(updatesChanged)try{await call("getUpdates",{offset,timeout:0,
      allowed_updates:previousAllowed});}catch{}
    db?.close();release();
    if(fs.existsSync(root))emit(root,{type:"stopped",probeId});
  }
}

run().catch(error=>{console.error(String(error.message??error)
  .replace(/\d{10}:[A-Za-z0-9_-]+/g,"[redacted]").slice(0,500));process.exitCode=1;});
