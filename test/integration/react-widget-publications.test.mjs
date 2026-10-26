import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../../src/storage/database.mjs";
import { createWidgetStore } from "../../src/widgets/store.mjs";
import * as publicationModule from "../../src/widgets/publications.mjs";
import { createMessageSerial } from "../../src/messages/serial.mjs";

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-publications-"));
  const db=openDatabase(path.join(dir,"db.sqlite"));
  db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
  db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
  db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
  const store=createWidgetStore(db),widget=store.create({botId:"b",agentId:"a",handler:"game.tsx",description:"Game"});
  const ref={widgetId:widget.widgetId,botId:"b",agentId:"a",generation:widget.generation};
  const calls=[];
  const telegram={async call(botId,method,args){calls.push({botId,method,args});if(method.startsWith("send"))return {message_id:21,chat:{id:-10,type:"supergroup"},rich_message:args.rich_message};return true;}};
  const close=()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});};
  return {db,store,ref,calls,telegram,close};
}
const projection=(text,revision=0)=>({body:{rich_message:{blocks:[{type:"paragraph",text}]}},replyMarkup:null,storeRevision:revision});

test("ordinary widget edits share the controller message lane and a detached view cannot publish again",async()=>{
  const x=fixture();try{
    const serial=createMessageSerial();
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram,messageSerial:serial});
    await publish.publish(x.ref,"v",{target:{chatId:-10,messageId:21},component:"Main",props:{},...projection("A")});
    let release;
    const external=serial.run({botId:"b",chatId:-10,messageId:21},()=>new Promise(resolve=>release=resolve));
    while(!release)await new Promise(resolve=>setTimeout(resolve,0));
    const pending=publish.publish(x.ref,"v",projection("B"));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(x.calls.length,1,"widget edit waits for the external edit");
    publish.invalidateView("v");
    x.store.detachView(x.ref,"v");
    release();await external;
    await assert.rejects(pending,/view_not_found/);
    assert.equal(x.calls.length,1,"detached view cannot reattach itself after the native edit");
  }finally{x.close();}
});

test("publication persists a confirmed send, skips no-op, then edits exactly once",async()=>{
  assert.equal(typeof publicationModule.createReactPublications,"function");
  const x=fixture();try{
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const send=await publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("A")});
    assert.equal(send.status,"confirmed");
    assert.equal(send.view.target.messageId,21);
    assert.equal(x.calls[0].method,"sendRichMessage");
    assert.equal((await publish.publish(x.ref,"v",projection("A"))).status,"unchanged");
    assert.equal(x.calls.length,1);
    const edit=await publish.publish(x.ref,"v",projection("B"));
    assert.equal(edit.status,"confirmed");
    assert.equal(x.calls[1].method,"editMessageText");
    assert.equal(x.calls.length,2);
  } finally{x.close();}
});

test("store revision must be saved before any native request",async()=>{
  const x=fixture();try{
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    await assert.rejects(publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("A",1)}),/state_not_saved/);
    assert.equal(x.calls.length,0);
    x.store.save(x.ref,{state:{count:1}});
    assert.equal((await publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("A",1)})).status,"confirmed");
  }finally{x.close();}
});

test("unknown send keeps candidate and refuses automatic duplicate",async()=>{
  const x=fixture();try{
    x.telegram.call=async()=>{throw Object.assign(Error("socket closed"),{code:"telegram_transport_failed"});};
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    assert.equal((await publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("A")})).status,"unknown");
    assert.equal(x.store.listCandidates(x.ref.widgetId).length,1);
    await assert.rejects(publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("A")}),/delivery_unknown/);
  }finally{x.close();}
});

test("unrelated Telegram 400 keeps the binding; confirmed missing removes it",async()=>{
  const x=fixture();try{
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    await publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("A")});
    x.telegram.call=async()=>{throw Object.assign(Error("Bad Request: wrong payload"),{code:"telegram_api_error"});};
    assert.equal((await publish.publish(x.ref,"v",projection("B"))).status,"view_error");
    assert.ok(x.store.getView("v"));
    x.telegram.call=async()=>{throw Object.assign(Error("message to edit not found"),{code:"telegram_api_error"});};
    assert.equal((await publish.publish(x.ref,"v",projection("C"))).status,"removed");
    assert.equal(x.store.getView("v"),null);
  }finally{x.close();}
});

test("inline boolean acknowledgement binds only the opaque confirmed address",async()=>{
  const x=fixture();try{
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const outcome=await publish.publish(x.ref,"inline",{target:{inlineMessageId:"opaque-participant"},component:"Main",props:{},...projection("A")});
    assert.equal(outcome.status,"confirmed");
    assert.deepEqual(outcome.view.target,{inlineMessageId:"opaque-participant"});
    assert.equal(x.calls[0].args.inline_message_id,"opaque-participant");
    assert.equal(x.calls[0].args.chat_id,undefined);
  }finally{x.close();}
});

test("late acknowledgement from a retired generation cannot overwrite a newer view",async()=>{
  const x=fixture();try{
    let acknowledge;
    x.telegram.call=async()=>new Promise(resolve=>acknowledge=resolve);
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const pending=publish.publish(x.ref,"v",{target:{chatId:-10},component:"Main",props:{},...projection("old")});
    while(!acknowledge)await new Promise(resolve=>setTimeout(resolve,0));
    x.store.replace(x.ref,{description:"new build"});
    acknowledge({message_id:44,chat:{id:-10,type:"supergroup"}});
    const outcome=await pending;
    assert.equal(outcome.status,"unknown");
    assert.equal(outcome.reason,"stale_generation");
    assert.equal(x.store.getView("v"),null);
  }finally{x.close();}
});

test("standalone ephemeral publication binds the returned recipient-scoped address",async()=>{
  const x=fixture();try{
    x.telegram.call=async(botId,method,args)=>{
      x.calls.push({botId,method,args});
      return {ephemeral_message_id:77,receiver_user:{id:5},chat:{id:-10,type:"supergroup"}};
    };
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const result=await publish.publish(x.ref,"private",{
      target:{chatId:-10,receiverUserId:5},component:"Main",props:{},...projection("Only for you")
    });
    assert.equal(result.status,"confirmed");
    assert.deepEqual(result.view.target,{chatId:-10,receiverUserId:5,ephemeralMessageId:77});
    assert.deepEqual(x.calls[0].args.ephemeral_message_parameters,{receiver_user_id:5});
  }finally{x.close();}
});

test("overlay publication uses the triggering callback and records its public parent",async()=>{
  const x=fixture();try{
    x.telegram.call=async(botId,method,args)=>{
      x.calls.push({botId,method,args});
      return {ephemeral_message_id:78,receiver_user:{id:5},chat:{id:-10,type:"supergroup"}};
    };
    const parent=x.store.createView(x.ref,{target:{chatId:-10,messageId:21},exportName:"Main",props:{}});
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const result=await publish.publish(x.ref,"overlay",{
      target:{chatId:-10,receiverUserId:5,callbackQueryId:"clicked",
        replaceCallbackQueryMessage:true},parentViewId:parent.id,
      component:null,props:{},...projection("Private overlay")});
    assert.equal(result.status,"confirmed");
    assert.equal(result.view.parentViewId,parent.id);
    assert.deepEqual(x.calls[0].args.ephemeral_message_parameters,
      {receiver_user_id:5,callback_query_id:"clicked",replace_callback_query_message:true});
  }finally{x.close();}
});

test("editing a public parent closes its overlays before the native edit",async()=>{
  const x=fixture();try{
    const order=[];
    x.telegram.call=async(_bot,method,args)=>{
      order.push(method);
      return method.startsWith("send")?{message_id:21,chat:{id:-10}}:true;
    };
    const parent=x.store.createView(x.ref,{target:{chatId:-10,messageId:21},exportName:"Main",props:{},
      projection:{body:projection("A").body,replyMarkup:null}});
    const overlay=x.store.createView(x.ref,{target:{chatId:-10,receiverUserId:5,ephemeralMessageId:77},
      parentViewId:parent.id});
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram,
      closeOverlays:async(_ref,parentId)=>{
        order.push("closeOverlays");
        x.store.detachView(x.ref,overlay.id);
        return [overlay.id];
      }});
    assert.equal((await publish.publish(x.ref,parent.id,projection("A"))).status,"unchanged");
    assert.deepEqual(order,[]);
    const result=await publish.publish(x.ref,parent.id,projection("B"));
    assert.deepEqual(order,["closeOverlays","editMessageText"]);
    assert.deepEqual(result.closedOverlayIds,[overlay.id]);
  }finally{x.close();}
});

test("database failure after Telegram acknowledgement records a partial effect and blocks resend",async()=>{
  const x=fixture();try{
    const realCreate=x.store.createView;
    x.store.createView=()=>{throw Error("disk full")};
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const input={target:{chatId:-10},component:"Main",props:{},...projection("A")};
    const outcome=await publish.publish(x.ref,"failed",input);
    assert.equal(outcome.status,"unknown");
    assert.equal(outcome.error.code,"storage_failed");
    x.store.createView=realCreate;
    await assert.rejects(publish.publish(x.ref,"failed",input),/delivery_unknown/);
    assert.equal(x.calls.length,1);
  }finally{x.close();}
});

test("managed sticker media is uploaded through controller transport and cached for keyboard edits",async()=>{
  const x=fixture();try{
    const file=path.join(x.db.filePath??os.tmpdir(),"react-sticker-fixture.webp");
    fs.writeFileSync(file,"sticker-bytes");
    const files={withParent(_name,_write,callback){return callback(file);},read(){return fs.readFileSync(file);}};
    x.telegram.call=async(botId,method,args,options)=>{
      x.calls.push({botId,method,args,options});
      return method==="sendSticker"?{message_id:21,chat:{id:-10},sticker:{file_id:"telegram-sticker"}}:true;
    };
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram,filesFor:()=>files});
    const result=await publish.publish(x.ref,"sticker",{target:{chatId:-10},component:"Sticker",props:{},
      body:{sticker:"file:sticker.webp"},replyMarkup:{inline_keyboard:[[{text:"Next",callback_data:"next"}]]},storeRevision:0});
    assert.equal(result.status,"confirmed");
    assert.equal(x.calls[0].args.sticker,"attach://widget_media_0");
    assert.equal(x.calls[0].options.uploads[0].bytes.toString(),"sticker-bytes");
    assert.equal(result.view.projection.body.sticker,"file:sticker.webp");
  }finally{x.close();}
});

test("late private acknowledgement after parent edit is deleted instead of bound",async()=>{
  const x=fixture();try{
    const parent=x.store.createView(x.ref,{target:{chatId:-10,messageId:21},exportName:"Main",props:{},
      projection:{body:projection("A").body,replyMarkup:null}});
    let resolvePrivate;
    x.telegram.call=async(botId,method,args)=>{
      x.calls.push({botId,method,args});
      if(method==="sendRichMessage")return new Promise(resolve=>resolvePrivate=resolve);
      return true;
    };
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const pending=publish.publish(x.ref,"late-private",{
      target:{chatId:-10,receiverUserId:5,callbackQueryId:"click",replaceCallbackQueryMessage:true},
      parentViewId:parent.id,component:null,props:{},...projection("private")});
    while(!resolvePrivate)await new Promise(resolve=>setTimeout(resolve,0));
    await publish.publish(x.ref,parent.id,projection("B"));
    resolvePrivate({ephemeral_message_id:78,receiver_user:{id:5}});
    const outcome=await pending;
    assert.equal(outcome.status,"removed");
    assert.equal(x.store.getView("late-private"),null);
    assert.ok(x.calls.some(call=>call.method==="deleteEphemeralMessage"&&call.args.ephemeral_message_id===78));
  }finally{x.close();}
});

test("late private acknowledgement after widget generation replacement is deleted",async()=>{
  const x=fixture();try{
    let resolvePrivate;
    x.telegram.call=async(botId,method,args)=>{
      x.calls.push({botId,method,args});
      if(method==="sendRichMessage")return new Promise(resolve=>resolvePrivate=resolve);
      return true;
    };
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram});
    const pending=publish.publish(x.ref,"late-private",{
      target:{chatId:-10,receiverUserId:5},component:"Main",props:{},...projection("private")});
    while(!resolvePrivate)await new Promise(resolve=>setTimeout(resolve,0));
    x.store.replace(x.ref,{description:"new generation"});
    resolvePrivate({ephemeral_message_id:79,receiver_user:{id:5}});
    assert.equal((await pending).status,"removed");
    assert.ok(x.calls.some(call=>call.method==="deleteEphemeralMessage"&&call.args.ephemeral_message_id===79));
  }finally{x.close();}
});

test("confirmed guest binding releases its prepared publication registration",async()=>{
  const x=fixture();try{
    const completed=[];
    const publish=publicationModule.createReactPublications({store:x.store,telegram:x.telegram,
      guest:{publish:async()=>({publicationId:"prepared-1",inlineMessageId:"guest-opaque",message:{inline_message_id:"guest-opaque"}}),
        complete:id=>completed.push(id)}});
    const outcome=await publish.publish(x.ref,"guest",{target:{guestRequestId:"request"},
      component:"Main",props:{},...projection("Hello")});
    assert.equal(outcome.status,"confirmed");
    assert.deepEqual(completed,["prepared-1"]);
  }finally{x.close();}
});
