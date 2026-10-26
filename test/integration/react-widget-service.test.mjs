import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {openDatabase} from "../../src/storage/database.mjs";
import {BotFiles} from "../../src/files/paths.mjs";
import {createWidgetService} from "../../src/widgets/service.mjs";
import {createWidgetEvents} from "../../src/widgets/events.mjs";

test("materialized sandbox compiles and publishes a React widget",{timeout:120000},async t=>{
  const executable=process.env.CODEX_EXECUTABLE??(process.platform==="win32"
    ?path.join(process.env.LOCALAPPDATA??"","Programs","OpenAI","Codex","bin","codex.exe")
    :"/usr/local/bin/codex");
  if(!fs.existsSync(executable)){t.skip("Codex sandbox executable is unavailable");return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"react-service-"));
  const db=openDatabase(path.join(root,"db.sqlite"));
  let service;
  try{
    db.registerBot({botId:"b",telegramId:42,username:"bot",ownerId:1});
    db.saveChat("b",{id:-10,type:"supergroup",title:"test"});
    const a=db.ensureAgent("b",-10),owner={botId:"b",agentId:a.agentId,chatId:-10};
    const botRoot=path.join(root,"bots","b");
    const files=new BotFiles(botRoot,a.agentId);
    files.write("basic.tsx",Buffer.from(`import React from "react";
import {defineStore,useSelector,useDispatch,useWidget} from "@tg-assistant/widget";
defineStore({version:1,initialState:{count:0,hint:""}});
export function Main({value}) {
  const count=useSelector(state=>state.count),hint=useSelector(state=>state.hint),dispatch=useDispatch(),widget=useWidget();
  return <><p>{value}: {count} {hint}</p><tg-keyboard><tg-button-row>
    <tg-button onClick={()=>dispatch(state=>{state.count++;})}>Increment</tg-button>
    <tg-button onClick={async()=>{const answer=await widget.requestAgent({text:"Provide a hint",responseSchema:{type:"object",properties:{hint:{type:"string"}},required:["hint"]}},{timeoutMs:5000});await dispatch(state=>{state.hint=answer.hint;});}}>Ask</tg-button>
  </tg-button-row></tg-keyboard></>;
}
`));
    const sent=[],requests=[];
    const serviceTelegram={async call(_bot,method,args){sent.push({method,args});
      if(method==="sendRichMessage"&&args.ephemeral_message_parameters)
        return {ephemeral_message_id:88,receiver_user:{id:args.ephemeral_message_parameters.receiver_user_id},
          chat:{id:-10,type:"supergroup"},rich_message:args.rich_message};
      return {message_id:77,chat:{id:-10,type:"supergroup"},rich_message:args.rich_message};}};
    service=createWidgetService({db,config:{dataDir:path.join(root,"data"),botsDir:path.join(root,"bots"),codexExecutable:executable},
      telegram:serviceTelegram,
      filesFor:()=>files,invoke:async()=>null,notify:async()=>{},
      requestQueue:{enqueue:(_ref,event)=>{requests.push(event);return "accepted";},cancel:()=>{}}});
    const {widgetId}=await service.create(owner,{handler:"basic.tsx",description:"basic"});
    const result=await service.setView(owner,{widgetId,component:"Main",props:{value:"Ready"},send:{chatId:-10}});
    assert.equal(result.target.messageId,77);
    assert.equal(sent[0].method,"sendRichMessage");
    assert.equal(service.store.getView(result.viewId).message.message_id,77);
    const token=service.store.getView(result.viewId).projection.replyMarkup.inline_keyboard[0][0].callback_data;
    const events=createWidgetEvents({db,manager:service,telegram:serviceTelegram});
    assert.equal(await events("b",{callback_query:{id:"click-1",data:token,from:{id:8},
      message:{message_id:77,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    for(let i=0;i<30&&!sent.some(call=>call.method==="editMessageText");i++)
      await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(service.store.get(widgetId).state.count,1);
    assert.ok(sent.some(call=>call.method==="editMessageText"));
    await service.updateStore(owner,{widgetId,state:{count:10}});
    assert.equal(service.store.get(widgetId).state.count,10);
    const ask=service.store.getView(result.viewId).projection.replyMarkup.inline_keyboard[0][1].callback_data;
    assert.equal(await events("b",{callback_query:{id:"click-2",data:ask,from:{id:8},
      message:{message_id:77,chat:{id:-10,type:"supergroup"}}}}),true);
    for(let i=0;i<50&&!requests.length;i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(requests[0]?.eventType,"widget_request");
    assert.equal(service.answerWidgetRequest(owner,{requestId:requests[0].requestId,result:{hint:"A"}}).status,"answered");
    await service.idle();
    assert.equal(service.store.get(widgetId).state.hint,"A");
    const privateView=await service.setView(owner,{widgetId,component:"Main",props:{value:"Private"},
      target:{chatId:-10,receiverUserId:8}});
    assert.equal(service.store.getView(privateView.viewId).target.ephemeralMessageId,88);
    await service.close();service=null;
    service=createWidgetService({db,config:{dataDir:path.join(root,"data"),botsDir:path.join(root,"bots"),codexExecutable:executable},
      telegram:serviceTelegram,filesFor:()=>files,invoke:async()=>null,notify:async()=>{},
      requestQueue:{enqueue:()=>"accepted",cancel:()=>{}}});
    await service.recover();
    assert.equal(service.store.get(widgetId).state.hint,"A");
    assert.ok(service.store.getView(result.viewId));
    assert.equal(service.store.getView(privateView.viewId),null);
    assert.ok(sent.some(call=>call.method==="deleteEphemeralMessage"&&call.args.ephemeral_message_id===88));
  }finally{await service?.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
});
