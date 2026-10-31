import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {openDatabase} from "../../src/storage/database.mjs";
import {createWidgetStore} from "../../src/widgets/store.mjs";
import {createReactPublications} from "../../src/widgets/publications.mjs";
import {createReactWidgetProcess} from "../../src/widgets/runtime-react.mjs";
import {createReactWidgetManager} from "../../src/widgets/manager-react.mjs";

test("an uncertain first send is returned immediately with a removable candidate",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-unknown-create-"));
  const db=openDatabase(path.join(dir,"db.sqlite"));let process;
  try{
    db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
    db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
    db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
    const store=createWidgetStore(db);let sends=0;
    const publications=createReactPublications({store,telegram:{async call(){sends++;throw Object.assign(Error("lost"),{code:"telegram_transport_failed"});}}});
    process=createReactWidgetProcess({retryDelayMs:20,request:async(method,args)=>{
      if(method==="save")return store.save(args.ref,{state:args.state,storeVersion:args.version,revision:args.revision});
      if(method==="publish")return publications.publish(args.ref,args.viewId,args);
      return null;
    }});
    const host={canReserve:()=>true,reserve:async()=>{},load:(ref,args)=>process.load(ref,args),
      request:(ref,method,args)=>process[method](ref,args),has:()=>true,release:async()=>{}};
    const snapshotPath=fileURLToPath(new URL("../fixtures/react-widgets/basic.mjs",import.meta.url));
    const manager=createReactWidgetManager({db,host,store,build:async()=>({snapshotId:"unknown-manager"}),
      authorize:()=>{},snapshotPath:()=>snapshotPath});
    const scope={botId:"b",agentId:"a",chatId:-10};
    const {widgetId}=await manager.create(scope,{handler:"basic.mjs",description:"Unknown send"});
    const result=await manager.setView(scope,{widgetId,component:"Main",send:{chatId:-10}});
    assert.equal(result.status,"error");assert.equal(result.error.code,"delivery_unknown");
    assert.equal(manager.get(scope,{widgetId}).possiblePublications[0].viewId,result.viewId);
    await new Promise(resolve=>setTimeout(resolve,70));assert.equal(sends,1);
    await manager.deleteView(scope,{viewId:result.viewId});
    assert.deepEqual(manager.get(scope,{widgetId}).possiblePublications,[]);
  }finally{await process?.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("an uncertain bound edit automatically repaints and restores the stored view",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-unknown-edit-"));
  const db=openDatabase(path.join(dir,"db.sqlite"));let process;
  try{
    db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
    db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
    db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
    const store=createWidgetStore(db),calls=[];let fail=false;
    const publications=createReactPublications({store,telegram:{async call(_bot,method,args){
      calls.push({method,args});if(fail){fail=false;throw Object.assign(Error("lost"),{code:"telegram_transport_failed"});}
      return {message_id:42,chat:{id:-10},rich_message:args.rich_message};
    }}});
    let manager;
    process=createReactWidgetProcess({retryDelayMs:30,request:async(method,args)=>{
      if(method==="save")return store.save(args.ref,{state:args.state,storeVersion:args.version,revision:args.revision});
      if(method==="publish")return publications.publish(args.ref,args.viewId,args);
      if(method==="notifyError")return manager.error(args.ref,args.error,args.viewId);
      return null;
    }});
    const host={canReserve:()=>true,reserve:async()=>{},load:(ref,args)=>process.load(ref,args),
      request:(ref,method,args)=>process[method](ref,args),has:()=>true,release:async()=>{}};
    const snapshotPath=fileURLToPath(new URL("../fixtures/react-widgets/basic.mjs",import.meta.url));
    manager=createReactWidgetManager({db,host,store,build:async()=>({snapshotId:"retry-manager"}),
      authorize:()=>{},snapshotPath:()=>snapshotPath});
    const scope={botId:"b",agentId:"a",chatId:-10};
    const {widgetId}=await manager.create(scope,{handler:"basic.mjs",description:"Edit"});
    const {viewId}=await manager.setView(scope,{widgetId,component:"Main",send:{chatId:-10},props:{value:"A"}});
    fail=true;
    const failed=await manager.setView(scope,{widgetId,viewId,props:{value:"B"}});
    assert.equal(failed.status,"error");assert.equal(store.getView(viewId).deliveryUnknown,true);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(calls.length,3);assert.equal(store.getView(viewId).deliveryUnknown,false);
    assert.equal(store.getView(viewId).status,"active");
    assert.equal(store.getView(viewId).projection.body.rich_message.blocks[0].text,"B");
  }finally{await process?.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("action acknowledgement precedes deletion and retains the finished projection",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-actions-"));
  const db=openDatabase(path.join(dir,"db.sqlite"));
  let process;
  try{
    db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
    db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
    db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
    const store=createWidgetStore(db),sent=[],disabled=[];
    let beginEdit,releaseEdit,failEdits=false;
    const editing=new Promise(resolve=>{beginEdit=resolve;});
    const gate=new Promise(resolve=>{releaseEdit=resolve;});
    const telegram={async call(_bot,method,args){
      sent.push({method,args});
      if(method==="editMessageText"){
        beginEdit();await gate;
        if(failEdits)throw Object.assign(new Error("Telegram rejected edit"),{code:"BUTTON_DATA_INVALID"});
      }
      return {message_id:42,chat:{id:-10,type:"supergroup"},
        ...(args.rich_message?{rich_message:args.rich_message}:{})};
    }};
    const publications=createReactPublications({store,telegram});
    process=createReactWidgetProcess({request:async(method,args)=>{
      if(method==="save")return store.save(args.ref,{state:args.state,storeVersion:args.version,revision:args.revision});
      if(method==="publish")return publications.publish(args.ref,args.viewId,args);
      return null;
    }});
    const host={canReserve:()=>true,reserve:async()=>{},load:(ref,args)=>process.load(ref,args),
      request:(ref,method,args)=>process[method](ref,args),has:()=>true,release:async()=>{}};
    const snapshotPath=fileURLToPath(new URL("../fixtures/react-widgets/actions.mjs",import.meta.url));
    const manager=createReactWidgetManager({db,host,store,build:async()=>({snapshotId:"actions-manager"}),
      authorize:()=>{},snapshotPath:()=>snapshotPath,
      disableView:async(_ref,view)=>disabled.push(view.projection.body.rich_message.blocks[0].text)});
    const scope={botId:"b",agentId:"a",chatId:-10};
    const {widgetId}=await manager.create(scope,{handler:"actions.mjs",description:"Round"});
    const {viewId}=await manager.setView(scope,{widgetId,component:"Main",send:{chatId:-10}});
    assert.deepEqual(await manager.dispatchAction(scope,{widgetId,action:"noop"}),{updatedViews:[]});
    const action=manager.dispatchAction(scope,{widgetId,action:"finishRound",args:{}});
    await editing;
    const deletion=manager.delete(scope,{widgetId});
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(store.get(widgetId),"delete must wait for the Telegram edit");
    assert.deepEqual(disabled,[]);
    releaseEdit();
    const result=await action;
    assert.deepEqual(result.updatedViews.map(view=>view.viewId),[viewId]);
    await deletion;
    assert.deepEqual(disabled,["Finished"]);
    assert.equal(store.get(widgetId),null);
    assert.ok(sent.some(call=>call.method==="editMessageText"&&
      call.args.rich_message.blocks[0].text==="Finished"));
    const second=await manager.create(scope,{handler:"actions.mjs",description:"Second round"});
    const secondView=await manager.setView(scope,{widgetId:second.widgetId,component:"Main",send:{chatId:-10}});
    failEdits=true;
    await assert.rejects(manager.updateStore(scope,{widgetId:second.widgetId,state:{finished:true}}),error=>{
      assert.equal(error.code,"view_render_failed");
      assert.deepEqual(error.failedViews.map(view=>view.viewId),[secondView.viewId]);
      return true;
    });
    assert.ok(store.get(second.widgetId),"a failed publication must retain its widget");
    const editsBefore=sent.filter(call=>call.method==="editMessageText").length;
    failEdits=false;
    await assert.rejects(manager.dispatchAction(scope,{widgetId:second.widgetId,action:"finishRound"}),
      {code:"view_render_failed"});
    assert.equal(sent.filter(call=>call.method==="editMessageText").length,editsBefore,
      "a previous view failure is not retried by an action");
  }finally{await process?.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test("agent creates a zero-view React widget then mounts a confirmed public view",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-manager-"));
  const db=openDatabase(path.join(dir,"db.sqlite"));
  try{
    db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
    db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
    db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
    const store=createWidgetStore(db),sent=[],notices=[],disabled=[];
    let now=1000;
    const telegram={async call(botId,method,args){sent.push({method,args});return {message_id:42,chat:{id:-10,type:"supergroup"},rich_message:args.rich_message};}};
    const publications=createReactPublications({store,telegram});
    const process=createReactWidgetProcess({request:async(method,args)=>{
      if(method==="save")return store.save(args.ref,{state:args.state,storeVersion:args.version,revision:args.revision});
      if(method==="publish")return publications.publish(args.ref,args.viewId,args);
      return null;
    }});
    const host={canReserve:()=>true,reserve:async()=>{},load:(ref,args)=>process.load(ref,args),
      request:(ref,method,args)=>process[method](ref,args),has:()=>true,release:async()=>{},close:async()=>{}};
    const snapshotPath=fileURLToPath(new URL("../fixtures/react-widgets/basic.mjs",import.meta.url));
    const manager=createReactWidgetManager({db,host,store,build:async()=>({snapshotId:"basic-manager"}),
      authorize:()=>{},snapshotPath:()=>snapshotPath,clock:()=>now,
      notify:async(_owner,event)=>notices.push(event),
      disableView:async(_ref,view)=>disabled.push(view.id)});
    const scope={botId:"b",agentId:"a",chatId:-10};
    const {widgetId}=await manager.create(scope,{handler:"basic.mjs",description:"Counter"});
    assert.equal(store.listViews(widgetId).length,0);
    const {viewId,target}=await manager.setView(scope,{widgetId,component:"Main",props:{value:"Hello"},send:{chatId:-10}});
    assert.deepEqual(target,{chatId:-10,messageId:42});
    assert.equal(store.getView(viewId).message.message_id,42);
    assert.equal(sent.length,1);
    const ref=store.get(widgetId);
    await manager.error(ref,{code:"render_failed",message:"broken"},viewId);
    await manager.error(ref,{code:"render_failed",message:"broken"},viewId);
    assert.equal(notices.length,1);
    now+=5*60*1000;
    await manager.error(ref,{code:"render_failed",message:"broken"},viewId);
    assert.equal(notices.length,2);
    assert.match(notices[1].description,/repeat/i);
    const privateView=store.createView(store.get(widgetId),{target:{chatId:-10,receiverUserId:9,ephemeralMessageId:91},
      parentViewId:viewId});
    store.patchView(store.get(widgetId),privateView.id,{activeAt:1000});
    assert.equal(await manager.expireEphemeralViews(1000+20*60*1000-1),0);
    assert.ok(store.getView(privateView.id));
    assert.equal(manager.touchEphemeral(privateView,8,2000),false);
    assert.equal(manager.touchEphemeral(privateView,9,2000),true);
    assert.equal(await manager.expireEphemeralViews(2000+20*60*1000-1),0);
    assert.equal(await manager.expireEphemeralViews(2000+20*60*1000),1);
    assert.equal(store.getView(privateView.id),null);
    await manager.detachExternal(store.get(widgetId),viewId);
    assert.equal(store.getView(viewId),null);
    assert.equal(sent.length,1,"external edit/delete already changed Telegram; detaching must not edit it again");
    const next=await manager.setView(scope,{widgetId,component:"Main",props:{value:"Again"},send:{chatId:-10}});
    const child=store.createView(store.get(widgetId),{target:{chatId:-10,receiverUserId:9,ephemeralMessageId:92},
      parentViewId:next.viewId});
    await manager.detachRuntimeView(store.get(widgetId),next.viewId);
    assert.equal(store.getView(child.id),null);
    assert.ok(disabled.includes(child.id),"unmounting a public parent must delete its private children");
    await manager.delete(scope,{widgetId});
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
