import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {openDatabase} from "../../src/storage/database.mjs";
import {BotFiles} from "../../src/files/paths.mjs";
import {createWidgetService} from "../../src/widgets/service.mjs";
import {createWidgetEvents} from "../../src/widgets/events.mjs";
import {prepareGuestResult} from "../../src/guest/results.mjs";
import {tile} from "../../examples/widgets/wordle/emoji.mjs";

const wordleKeys=[..."АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"];
const richBlocks=view=>view.projection.body.rich_message.blocks;
const richButton=(view,label)=>richBlocks(view)
  .filter(block=>block.type==="buttons").flatMap(block=>block.buttons)
  .find(button=>typeof button.text==="string"&&button.text.includes(label));
const keyCell=(view,letter)=>{
  const table=richBlocks(view).find(block=>block.type==="table"&&block.cells.length===4&&
    block.cells.every(row=>row.length===8));
  const index=wordleKeys.indexOf(letter);
  return table?.cells[Math.floor(index/8)]?.[index%8];
};
const keyButton=(view,letter)=>keyCell(view,letter)?.text?.[0]?.button;
const textContent=value=>typeof value==="string"?value:Array.isArray(value)
  ?value.map(textContent).join(""):value&&typeof value==="object"
    ?textContent(value.text??""):"";

async function waitFor(predicate,timeoutMs=5000,diagnostics=()=>undefined){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.fail(`Timed out waiting for a confirmed projection: ${JSON.stringify(diagnostics())}`);
}

test("fresh Wordle assets publish Players and a separate launcher with a private game",{timeout:120000},async t=>{
  const executable=process.env.CODEX_EXECUTABLE??(process.platform==="win32"
    ?path.join(process.env.LOCALAPPDATA??"","Programs","OpenAI","Codex","bin","codex.exe")
    :"/usr/local/bin/codex");
  if(!fs.existsSync(executable)){t.skip("Codex sandbox executable is unavailable");return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"react-wordle-ui-")),db=openDatabase(path.join(root,"db.sqlite"));
  let service;
  try{
    db.registerBot({botId:"b",telegramId:42,username:"bot",ownerId:1});
    db.saveChat("b",{id:-10,type:"supergroup",title:"test"});
    const a=db.ensureAgent("b",-10),scope={botId:"b",agentId:a.agentId,chatId:-10};
    const botRoot=path.join(root,"bots","b"),widgetDir=path.join(botRoot,"widgets","wordle");
    fs.mkdirSync(path.dirname(widgetDir),{recursive:true});
    fs.cpSync(path.resolve("examples/widgets/wordle"),widgetDir,{recursive:true});
    const files=new BotFiles(botRoot,a.agentId),calls=[],notifications=[];
    let messageId=40,ephemeralId=80;
    const missingPrivateMessages=new Set();
    const telegram={async call(_bot,method,args){
      calls.push({method,args});
      if(method==="deleteEphemeralMessage"&&
        missingPrivateMessages.has(args.ephemeral_message_id))
        throw Object.assign(new Error("Telegram API error 400: MESSAGE_NOT_FOUND"),
          {code:"telegram_api_error"});
      if(method.startsWith("send"))return args.ephemeral_message_parameters
        ?{message_id:0,ephemeral_message_id:++ephemeralId,receiver_user:{id:args.ephemeral_message_parameters.receiver_user_id},
          chat:{id:-10,type:"supergroup"},rich_message:args.rich_message}
        :{message_id:++messageId,chat:{id:-10,type:"supergroup"},rich_message:args.rich_message};
      if(method.startsWith("edit")&&args.inline_message_id)return true;
      if(method.startsWith("edit"))return {message_id:args.message_id??0,
        ...(args.ephemeral_message_id?{ephemeral_message_id:args.ephemeral_message_id}:{}),
        chat:{id:-10,type:"supergroup"},...(args.rich_message?{rich_message:args.rich_message}:{})};
      return true;
    }};
    service=createWidgetService({db,config:{dataDir:path.join(root,"data"),botsDir:path.join(root,"bots"),codexExecutable:executable},
      telegram,filesFor:()=>files,invoke:async()=>null,notify:async(_owner,event)=>{
        notifications.push(event);return "accepted";
      },
      inlineStore:{assertOwner:()=>{}},guest:{
        prepare:(guestScope,body)=>prepareGuestResult(guestScope,body,{origin:"widget"}),
        publishPrepared:async(_scope,{prepared})=>{
          assert.equal(prepared.native.type,"article");
          return {inlineMessageId:"guest-inline",message:prepared.snapshot};
        },
      }});
    const {widgetId}=await service.create(scope,{handler:"widgets/wordle/widget.tsx",description:"Wordle",
      props:{length:4,wordMode:"shared",notify:true}});
    assert.equal(service.store.get(widgetId).status,"active",JSON.stringify(service.store.get(widgetId).lastError));
    const players=await service.setView(scope,{widgetId,component:"Players",send:{chatId:-10}});
    const input=await service.setView(scope,{widgetId,component:"GameInput",
      send:{chatId:-10,reply_parameters:{message_id:players.target.messageId}}});
    assert.equal(service.store.get(widgetId).state.round.wordMode,"shared");
    assert.equal(calls.filter(call=>call.method==="sendRichMessage").length,2);
    assert.equal(calls[1].args.reply_parameters.message_id,players.target.messageId);
    const launcher=service.store.getView(input.viewId),token=richButton(launcher,"Начать")?.callback_data;
    assert.ok(token,"the public launcher uses an in-message rich button");
    assert.equal(launcher.projection.replyMarkup,null);
    const route=createWidgetEvents({db,manager:service,telegram});
    assert.equal(await route("b",{callback_query:{id:"start-7",from:{id:7,first_name:"Seven"},data:token,
      message:{message_id:input.target.messageId,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    const privateSend=calls.find(call=>call.method==="sendRichMessage"&&
      call.args.ephemeral_message_parameters?.receiver_user_id===7);
    assert.ok(privateSend,JSON.stringify({calls:calls.map(call=>call.method),
      views:service.store.listViews(widgetId).map(view=>({id:view.id,status:view.status,lastError:view.lastError})),
      widgetError:service.store.get(widgetId).lastError}));
    assert.equal(privateSend.args.ephemeral_message_parameters.replace_callback_query_message,true);
    const views=service.store.listViews(widgetId);
    let overlay=views.find(view=>view.targetKind==="ephemeral");
    assert.equal(overlay.parentViewId,input.viewId);
    assert.match(JSON.stringify(overlay.projection.body),/custom_emoji_id/,
      "private board retains the supplied tile artwork");
    const privateBlocks=richBlocks(overlay);
    assert.equal(privateBlocks.slice(0,privateBlocks.findIndex(block=>block.type==="divider"))
      .filter(block=>block.type==="paragraph"&&
      JSON.stringify(block.text).includes("custom_emoji_id")).length,6,
    "the game presents all six rows, including empty attempts");
    assert.ok(keyButton(overlay,"А")?.callback_data,
      "the keyboard uses clickable custom-emoji rich buttons inside a four-row table");
    assert.equal(keyButton(overlay,"А").style,"link");
    assert.equal(keyButton(overlay,"А").text[0].custom_emoji_id,tile("А","red").custom_emoji_id);
    assert.deepEqual(richBlocks(overlay).find(block=>block.type==="buttons"&&
      block.buttons.some(button=>button.text==="Enter")).buttons.map(button=>button.style),
      ["default","danger","success"]);
    assert.ok(richButton(overlay,"Закрыть")?.callback_data);
    assert.equal(overlay.projection.replyMarkup,null);
    assert.equal(service.store.get(widgetId).state.players["7"].name,"Seven");
    assert.equal(await route("b",{callback_query:{id:"start-8",from:{id:8,first_name:"Eight"},data:token,
      message:{message_id:input.target.messageId,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    assert.equal(service.store.listViews(widgetId).filter(view=>view.targetKind==="ephemeral").length,2);
    assert.equal(service.store.get(widgetId).state.players["8"].status,"playing");
    const secondOverlay=service.store.listViews(widgetId).find(view=>view.targetKind==="ephemeral"&&
      view.target.receiverUserId===8);
    missingPrivateMessages.add(secondOverlay.target.ephemeralMessageId);
    assert.equal(await route("b",{callback_query:{id:"close-8",from:{id:8,first_name:"Eight"},
      data:richButton(secondOverlay,"Закрыть").callback_data,
      message:{message_id:0,ephemeral_message_id:secondOverlay.target.ephemeralMessageId,
        chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    assert.equal(service.store.getView(secondOverlay.id),null,"Close removes only Eight's overlay");
    assert.equal(service.store.listViews(widgetId).filter(view=>view.targetKind==="ephemeral").length,1);
    assert.equal(await route("b",{callback_query:{id:"reopen-8",from:{id:8,first_name:"Eight"},
      data:token,message:{message_id:input.target.messageId,
        chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    assert.equal(service.store.listViews(widgetId).filter(view=>view.targetKind==="ephemeral").length,2);
    // A Telegram Revert has no bot update. Reopening from the public launcher must
    // send a new private message to Seven even when deleting the stale overlay
    // reports MESSAGE_NOT_FOUND, while Eight's overlay remains intact.
    const oldOverlay=overlay;
    missingPrivateMessages.add(oldOverlay.target.ephemeralMessageId);
    assert.equal(await route("b",{callback_query:{id:"start-7-after-revert",
      from:{id:7,first_name:"Seven"},data:token,
      message:{message_id:input.target.messageId,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    overlay=service.store.listViews(widgetId).find(view=>view.targetKind==="ephemeral"&&
      view.target.receiverUserId===7);
    assert.ok(overlay);
    assert.notEqual(overlay.id,oldOverlay.id);
    assert.notEqual(overlay.target.ephemeralMessageId,oldOverlay.target.ephemeralMessageId);
    assert.equal(service.store.getView(oldOverlay.id),null);
    assert.equal(service.store.listViews(widgetId).filter(view=>view.targetKind==="ephemeral").length,2);
    assert.ok(calls.some(call=>call.method==="deleteEphemeralMessage"&&
      call.args.ephemeral_message_id===oldOverlay.target.ephemeralMessageId));
    assert.ok(calls.some(call=>call.method==="sendRichMessage"&&
      call.args.ephemeral_message_parameters?.callback_query_id==="start-7-after-revert"));
    const answer=service.store.get(widgetId).state.round.sharedAnswer;
    for(let i=0;i<answer.length;i++){
      const current=service.store.getView(overlay.id);
      const button=keyButton(current,answer[i]);
      assert.ok(button,`missing letter button ${answer[i]}`);
      assert.equal(await route("b",{callback_query:{id:`key-${i}`,from:{id:7,first_name:"Seven"},
        data:button.callback_data,message:{message_id:0,ephemeral_message_id:overlay.target.ephemeralMessageId,
          chat:{id:-10,type:"supergroup"}}}}),true);
      await service.idle();
    }
    await waitFor(()=>richButton(service.store.getView(overlay.id),"Enter")?.callback_data);
    const enter=richButton(service.store.getView(overlay.id),"Enter");
    assert.equal(await route("b",{callback_query:{id:"enter-7",from:{id:7,first_name:"Seven"},
      data:enter.callback_data,message:{message_id:0,ephemeral_message_id:overlay.target.ephemeralMessageId,
        chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    assert.deepEqual(service.store.get(widgetId).state.players["7"].guesses,[answer]);
    assert.equal(service.store.get(widgetId).state.players["7"].status,"won");
    assert.ok(JSON.stringify(richBlocks(service.store.getView(overlay.id))).includes("Победа!"));
    assert.equal(keyCell(service.store.getView(overlay.id),"А").is_header,true);
    assert.ok(keyButton(service.store.getView(overlay.id),"А").callback_data,
      "inactive keyboard keys remain enabled but use a no-op callback");
    assert.equal(notifications.filter(event=>event.eventType==="widget_message"&&
      event.widgetId===widgetId).length,1,"one accepted winning Enter sends one owner notification");
    assert.equal(service.store.get(widgetId).state.players["8"].status,"playing");
    await waitFor(()=>JSON.stringify(service.store.getView(players.viewId).projection).includes("🟩"));
    const publicProjection=JSON.stringify(service.store.getView(players.viewId).projection);
    assert.ok(publicProjection.includes("Seven"),JSON.stringify({projection:publicProjection.slice(0,1200),
      error:service.store.getView(players.viewId).lastError,calls:calls.map(call=>call.method)}));
    assert.ok(publicProjection.includes("🟩"));
    assert.ok(!publicProjection.includes(service.store.get(widgetId).state.round.sharedAnswer),
      "unfinished shared answer must not leak into Players projection");
    const finished=structuredClone(service.store.get(widgetId).state);
    finished.round.status="finished";finished.round.finishedAt=Date.now();
    await service.updateStore(scope,{widgetId,state:finished});
    await waitFor(()=>service.store.listViews(widgetId).filter(view=>view.targetKind==="ephemeral").length===0);
    await waitFor(()=>JSON.stringify(service.store.getView(players.viewId).projection).includes(`Ответ: ${answer}`),
      8000,()=>({round:service.store.get(widgetId).state.round,
        playerView:service.store.getView(players.viewId),
        inputView:service.store.getView(input.viewId),
        calls:calls.map(call=>call.method)}));
    await service.idle();
    const finishedRows=richBlocks(service.store.getView(players.viewId))
      .find(block=>block.type==="table").cells;
    const winningRow=finishedRows.find(row=>textContent(row[0].text).includes("Seven"));
    assert.equal(textContent(winningRow[1].text),[...answer].join(" "),
      "accepted letters in Progress are separated by one space");
    assert.equal(winningRow[1].text.filter(part=>part.type==="marked"&&
      part.text?.some?.(inner=>inner.type==="bold")).length,answer.length,
    "every green letter is both marked and bold");
    assert.deepEqual(notifications.filter(event=>event.eventType==="widget_error"),[],
      "finishing a round should not report already-detached overlays as widget errors");
    const inline=await service.create(scope,{handler:"widgets/wordle/widget.tsx",description:"Inline Wordle",
      props:{length:4,wordMode:"individual"}});
    const shared=await service.setView(scope,{widgetId:inline.widgetId,component:"GameShared",
      target:{inlineMessageId:"canonical-inline"}});
    assert.equal(shared.target.inlineMessageId,"canonical-inline");
    const begin=richButton(service.store.getView(shared.viewId),"Начать");
    assert.ok(begin?.callback_data);
    assert.equal(await route("b",{callback_query:{id:"inline-start-9",from:{id:9,first_name:"Nine"},
      inline_message_id:"canonical-inline",data:begin.callback_data}}),true);
    await service.idle();
    assert.equal(service.store.get(inline.widgetId).state.sharedSessions[shared.viewId].activeUserId,9);
    await waitFor(()=>richButton(service.store.getView(shared.viewId),"закрыть")?.callback_data);
    const close=richButton(service.store.getView(shared.viewId),"закрыть");
    assert.equal(await route("b",{callback_query:{id:"inline-close-9",from:{id:9,first_name:"Nine"},
      inline_message_id:"canonical-inline",data:close.callback_data}}),true);
    await service.idle();
    assert.equal(service.store.get(inline.widgetId).state.sharedSessions[shared.viewId].activeUserId,null);
    await waitFor(()=>Boolean(richButton(service.store.getView(shared.viewId),"Начать")));
    const restart=richButton(service.store.getView(shared.viewId),"Начать");
    assert.equal(await route("b",{callback_query:{id:"inline-restart-9",
      from:{id:9,first_name:"Nine"},inline_message_id:"canonical-inline",
      data:restart.callback_data}}),true);
    await service.idle();
    const expired=structuredClone(service.store.get(inline.widgetId).state);
    expired.sharedSessions[shared.viewId].expiresAt=Date.now()-1;
    await service.updateStore(scope,{widgetId:inline.widgetId,state:expired});
    await waitFor(()=>Boolean(richButton(service.store.getView(shared.viewId),"В меню")),
      5000,()=>({session:service.store.get(inline.widgetId).state.sharedSessions[shared.viewId],
        viewStatus:service.store.getView(shared.viewId)?.status,
        viewError:service.store.getView(shared.viewId)?.lastError,
        buttons:richBlocks(service.store.getView(shared.viewId))
          .filter(block=>block.type==="buttons").flatMap(block=>block.buttons.map(button=>button.text))}));
    const pausedView=service.store.getView(shared.viewId);
    assert.ok(JSON.stringify(richBlocks(pausedView)).includes("Игра на паузе."));
    assert.ok(keyButton(pausedView,"А"),"expired game keeps the field and rich keyboard visible");
    assert.equal(keyCell(pausedView,"А").is_header,true);
    assert.ok(keyButton(pausedView,"А").callback_data);
    assert.equal(richButton(pausedView,"Начать"),undefined);
    const beforeIgnoredKey=structuredClone(service.store.get(inline.widgetId).state);
    assert.equal(await route("b",{callback_query:{id:"inline-paused-key-10",
      from:{id:10,first_name:"Ten"},inline_message_id:"canonical-inline",
      data:keyButton(pausedView,"А").callback_data}}),true);
    await service.idle();
    assert.deepEqual(service.store.get(inline.widgetId).state,beforeIgnoredKey);
    assert.equal(await route("b",{callback_query:{id:"inline-menu-10",
      from:{id:10,first_name:"Ten"},inline_message_id:"canonical-inline",
      data:richButton(pausedView,"В меню").callback_data}}),true);
    await service.idle();
    assert.equal(service.store.get(inline.widgetId).state.sharedSessions[shared.viewId].activeUserId,null);
    await waitFor(()=>Boolean(richButton(service.store.getView(shared.viewId),"Начать")));
    const guestWidget=await service.create(scope,{handler:"widgets/wordle/widget.tsx",description:"Guest Wordle",
      props:{length:4,wordMode:"individual"}});
    const guestView=await service.setView(scope,{widgetId:guestWidget.widgetId,component:"GameShared",
      send:{guestRequestId:"guest-request"}});
    assert.deepEqual(guestView.target,{inlineMessageId:"guest-inline"});
    assert.ok(richButton(service.store.getView(guestView.viewId),"Начать")?.callback_data);
    const nerdle=await service.create(scope,{handler:"widgets/wordle/nerdle.tsx",description:"Nerdle",
      props:{length:8,wordMode:"shared"}});
    const nerdlePlayers=await service.setView(scope,{widgetId:nerdle.widgetId,component:"Players",send:{chatId:-10}});
    const nerdleInput=await service.setView(scope,{widgetId:nerdle.widgetId,component:"GameInput",
      send:{chatId:-10,reply_parameters:{message_id:nerdlePlayers.target.messageId}}});
    const nerdleStart=richButton(service.store.getView(nerdleInput.viewId),"Начать")?.callback_data;
    assert.equal(await route("b",{callback_query:{id:"nerdle-start-11",from:{id:11,first_name:"Eleven"},
      data:nerdleStart,message:{message_id:nerdleInput.target.messageId,chat:{id:-10,type:"supergroup"}}}}),true);
    await service.idle();
    assert.equal(service.store.get(nerdle.widgetId).state.round.length,8);
    assert.equal(service.store.get(nerdle.widgetId).state.round.sharedAnswer.length,8);
    assert.ok(service.store.listViews(nerdle.widgetId).some(view=>view.targetKind==="ephemeral"&&view.receiverUserId===11));
  }finally{await service?.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
});
