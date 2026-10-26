import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {openDatabase} from "../../src/storage/database.mjs";
import {BotFiles} from "../../src/files/paths.mjs";
import {createWidgetService} from "../../src/widgets/service.mjs";
import {createWidgetEvents} from "../../src/widgets/events.mjs";
import {createDictionaryStore} from "../../examples/widgets/wordle/dictionary-store.mjs";

test("dictionary edits keep broad and selected pools distinct and append committed audit",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"react-dictionary-files-"));
  try{
    const base=path.join(root,"wordle"),audit=path.join(root,"audit");
    fs.mkdirSync(base);
    for(const length of [4,5,6,7,8])for(const suffix of ["","-select"])
      fs.writeFileSync(path.join(base,`wordle-dictionary-${length}${suffix}.txt`),"ТЕСТ\n");
    const dictionary=createDictionaryStore(base),word="ФЬХЦ";
    assert.equal(dictionary.has(word,4),false);
    assert.equal(dictionary.edit(word,"add",7,audit).changed,2);
    assert.equal(dictionary.isUsed(word),true);
    assert.equal(dictionary.edit(word,"disable",7,audit).changed,1);
    assert.equal(dictionary.has(word,4),true,"disabled words stay valid guesses");
    assert.equal(dictionary.isUsed(word),false);
    assert.equal(dictionary.edit(word,"enable",7,audit).changed,1);
    assert.equal(dictionary.isUsed(word),true);
    assert.equal(dictionary.edit(word,"remove",7,audit).changed,2);
    assert.equal(dictionary.has(word,4),false);
    assert.equal(dictionary.isUsed(word),false);
    assert.equal(dictionary.edit(word,"remove",7,audit).changed,0,"retries do not invert state");
    const entries=fs.readFileSync(path.join(audit,"wordle-dictionary-edits.jsonl"),"utf8")
      .trim().split("\n").map(line=>JSON.parse(line));
    assert.equal(entries.filter(entry=>entry.phase==="committed").length,4);
    assert.ok(entries.every(entry=>entry.actor_id===7));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

function buttonOf(value,predicate){
  if(!value||typeof value!=="object")return null;
  if(value.callback_data&&predicate(value))return value;
  for(const child of Object.values(value)){
    const found=buttonOf(child,predicate);if(found)return found;
  }
  return null;
}

test("fresh dictionary editor publishes rich table and commits a desired Use state",{timeout:120000},async t=>{
  const executable=process.env.CODEX_EXECUTABLE??(process.platform==="win32"
    ?path.join(process.env.LOCALAPPDATA??"","Programs","OpenAI","Codex","bin","codex.exe")
    :"/usr/local/bin/codex");
  if(!fs.existsSync(executable)){t.skip("Codex sandbox executable is unavailable");return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"react-dictionary-")),db=openDatabase(path.join(root,"db.sqlite"));
  let service;
  try{
    db.registerBot({botId:"b",telegramId:42,username:"bot",ownerId:1});
    db.saveChat("b",{id:-10,type:"supergroup",title:"test"});
    const a=db.ensureAgent("b",-10),scope={botId:"b",agentId:a.agentId,chatId:-10};
    const botRoot=path.join(root,"bots","b"),widgetDir=path.join(botRoot,"widgets","wordle");
    fs.mkdirSync(path.dirname(widgetDir),{recursive:true});
    fs.cpSync(path.resolve("examples/widgets/wordle"),widgetDir,{recursive:true});
    const files=new BotFiles(botRoot,a.agentId),calls=[];
    const telegram={async call(_bot,method,args){calls.push({method,args});
      return method.startsWith("send")?{message_id:41,chat:{id:-10,type:"supergroup"},rich_message:args.rich_message}
        :method.startsWith("edit")?{message_id:41,chat:{id:-10,type:"supergroup"},rich_message:args.rich_message}:true;
    }};
    service=createWidgetService({db,config:{dataDir:path.join(root,"data"),botsDir:path.join(root,"bots"),codexExecutable:executable},
      telegram,filesFor:()=>files,invoke:async()=>null,notify:async()=>{}});
    const {widgetId}=await service.create(scope,{handler:"widgets/wordle/dictionary-admin.tsx",description:"Editor",
      props:{auditChatId:-10}});
    const publication=await service.setView(scope,{widgetId,component:"Editor",send:{chatId:-10}});
    const {viewId}=publication;
    assert.ok(service.store.getView(viewId),JSON.stringify({publication,
      candidate:service.store.getCandidate(viewId),widget:service.store.get(widgetId)}));
    const projection=service.store.getView(viewId).projection;
    assert.ok(projection.body.rich_message.blocks.some(block=>block.type==="table"));
    assert.equal(projection.replyMarkup,null,"editor controls belong in the rich message");
    assert.equal(projection.body.rich_message.blocks[0].type,"buttons",
      "dictionary modes appear above the heading");
    const selectedFiles=[4,5,6,7,8].map(length=>path.join(widgetDir,`wordle-dictionary-${length}-select.txt`));
    const countSelected=()=>selectedFiles.reduce((count,file)=>count+fs.readFileSync(file,"utf8").trim().split(/\s+/).filter(Boolean).length,0);
    const before=countSelected();
    const use=buttonOf(projection.body,button=>String(button.text).includes("Use"));
    assert.ok(use,"a rich Use button must be projected");
    const token=use.callback_data;
    assert.equal(await createWidgetEvents({db,manager:service,telegram})("b",{callback_query:{
      id:"edit-use",from:{id:7},data:token,message:{message_id:41,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    for(let i=0;i<100&&!calls.some(call=>call.method==="editMessageText");i++)
      await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(calls.some(call=>call.method==="editMessageText"),JSON.stringify({
      calls:calls.map(call=>call.method),lastError:service.store.getView(viewId).lastError,
      state:service.store.get(widgetId).state,audit:fs.existsSync(path.join(botRoot,"chats","-10","wordle-dictionary-edits.jsonl"))}));
    assert.ok(fs.existsSync(path.join(botRoot,"chats","-10","wordle-dictionary-edits.jsonl")));
    assert.equal(countSelected(),before+1);
    const audit=fs.readFileSync(path.join(botRoot,"chats","-10","wordle-dictionary-edits.jsonl"),"utf8");
    assert.match(audit,/committed/);
    const mode=buttonOf(service.store.getView(viewId).projection.body,
      button=>String(button.text).includes("✏"));
    assert.ok(mode,"rich edit-mode button must be projected");
    const editCount=calls.filter(call=>call.method==="editMessageText").length;
    assert.equal(await createWidgetEvents({db,manager:service,telegram})("b",{callback_query:{
      id:"edit-mode",from:{id:7},data:mode.callback_data,
      message:{message_id:41,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    for(let i=0;i<100&&calls.filter(call=>call.method==="editMessageText").length===editCount;i++)
      await new Promise(resolve=>setTimeout(resolve,20));
    const editing=service.store.getView(viewId).projection;
    assert.equal(editing.replyMarkup,null);
    assert.ok(editing.body.rich_message.blocks.some(block=>block.type==="table"&&
      block.is_bordered&&block.cells.length===4),JSON.stringify({
        blocks:editing.body.rich_message.blocks.map(block=>({type:block.type,
          bordered:block.is_bordered,rows:block.cells?.length})),
        state:service.store.get(widgetId).state,lastError:service.store.getView(viewId).lastError}));
    assert.ok(editing.body.rich_message.blocks.some(block=>block.type==="paragraph"&&
      JSON.stringify(block).includes("custom_emoji")),"input has colored custom-emoji tiles");
  }finally{await service?.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
});
