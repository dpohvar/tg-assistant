import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createReactWidgetProcess} from "../../src/widgets/runtime-react.mjs";

test("action waits for view acknowledgement and reports partial publication failure",async()=>{
  let release,fail=false,waitOnce=true;
  const requested=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    if(method==="publish"){
      requested.push(args);
      if(fail&&args.viewId==="second")return {status:"view_error",error:{code:"MESSAGE_NOT_FOUND",message:"gone"}};
      if(fail&&args.viewId==="first"&&waitOnce){
        waitOnce=false;await new Promise(resolve=>{release=resolve;});
      }
      return {status:"confirmed",target:args.target,view:{target:args.target,
        message:{message_id:args.target.messageId}}};
    }
    return null;
  }});
  const ref={widgetId:"action-process",botId:"b",agentId:"a",generation:1};
  try{
    await process.load(ref,{buildId:"action-process",snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/actions.mjs",import.meta.url))});
    await process.mount(ref,{viewId:"first",target:{chatId:1,messageId:1},component:"Main"});
    await process.mount(ref,{viewId:"second",target:{chatId:1,messageId:2},component:"Main"});
    requested.length=0;fail=true;
    const pending=process.dispatchAction(ref,{action:"finishRound",args:{}});
    for(let i=0;i<30&&!release;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof release,"function");
    let settled=false;pending.finally(()=>{settled=true;}).catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(settled,false,"action must wait for the Telegram acknowledgement");
    release();
    await assert.rejects(pending,error=>{
      assert.equal(error.code,"view_render_failed");
      assert.deepEqual(error.updatedViews.map(view=>view.viewId),["first"]);
      assert.deepEqual(error.failedViews.map(view=>view.viewId),["second"]);
      return true;
    });
    assert.ok(requested.some(item=>item.viewId==="first"));
    assert.ok(requested.some(item=>item.viewId==="second"));
  }finally{await process.retire(ref).catch(()=>{});}
});

test("sandbox process publishes a confirmed React view through its bridge",async()=>{
  const calls=[];
  const request=async(method,args)=>{
    calls.push({method,args});
    if(method==="publish")return {status:"confirmed",target:{chatId:1,messageId:7},view:{target:{chatId:1,messageId:7},message:{message_id:7}}};
    return null;
  };
  const process=createReactWidgetProcess({request});
  const ref={widgetId:"process-w",botId:"b",agentId:"a",generation:1};
  try{
    await process.load(ref,{buildId:"basic-process",snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/basic.mjs",import.meta.url))});
    const result=await process.mount(ref,{viewId:"v",target:{chatId:1},component:"Main",props:{value:"Hello"}});
    assert.equal(result.status,"active");
    assert.deepEqual(result.target,{chatId:1,messageId:7});
    assert.equal(calls.filter(call=>call.method==="publish").length,1);
    assert.equal(calls.find(call=>call.method==="publish").args.body.rich_message.blocks[0].text,"Hello");
  }finally{await process.retire(ref);}
});

test("retiring one widget keeps the other widget's current callback",async()=>{
  const published=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    if(method==="publish"){
      published.push(args);
      return {status:"confirmed",target:{chatId:1,messageId:published.length},
        view:{target:{chatId:1,messageId:published.length},message:{message_id:published.length}}};
    }
    return null;
  }});
  const fixture=fileURLToPath(new URL("../fixtures/react-widgets/button.mjs",import.meta.url));
  const first={widgetId:"callback-one",botId:"b",agentId:"a",generation:1};
  const second={widgetId:"callback-two",botId:"b",agentId:"a",generation:1};
  globalThis.__reactWidgetButtonEvents=[];
  try{
    await process.load(first,{buildId:"button-process",snapshotPath:fixture});
    await process.load(second,{buildId:"button-process",snapshotPath:fixture});
    await process.mount(first,{viewId:"v-one",target:{chatId:1},component:"Main",props:{label:"one"}});
    await process.mount(second,{viewId:"v-two",target:{chatId:1},component:"Main",props:{label:"two"}});
    const token=published.at(-1).replyMarkup.inline_keyboard[0][0].callback_data;
    await process.retire(first);
    await process.callback(second,{viewId:"v-two",token,event:{from:{id:5}}});
    assert.deepEqual(globalThis.__reactWidgetButtonEvents,[{label:"two",from:5}]);
  }finally{await process.retire(second);delete globalThis.__reactWidgetButtonEvents;}
});

test("view hooks receive confirmed sends and opted-in incoming events",async()=>{
  const calls=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    calls.push({method,args});
    if(method==="publish")return {status:"confirmed",target:{chatId:1,messageId:9},
      view:{target:{chatId:1,messageId:9},message:{message_id:9}}};
    return null;
  }});
  const ref={widgetId:"hook-widget",botId:"b",agentId:"a",generation:1};
  globalThis.__reactWidgetSubscriptions=[];
  try{
    await process.load(ref,{buildId:"subscription-process",snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/subscription.mjs",import.meta.url))});
    await process.mount(ref,{viewId:"v-hook",target:{chatId:1},component:"Main",props:{disabled:false}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(globalThis.__reactWidgetSubscriptions,[["message",9]]);
    assert.deepEqual(calls.filter(call=>call.method==="subscription").map(call=>[call.args.type,call.args.active]),
      [["reply",true],["reaction",true]]);
    await process.event(ref,{viewId:"v-hook",type:"reply",event:{from:{id:5}}});
    await process.event(ref,{viewId:"v-hook",type:"reaction",event:{from:{id:6}}});
    assert.deepEqual(globalThis.__reactWidgetSubscriptions.at(-2),["reply",5]);
    assert.deepEqual(globalThis.__reactWidgetSubscriptions.at(-1),["reaction",6]);
    await process.mount(ref,{viewId:"v-hook",component:"Main",props:{disabled:true}});
    assert.deepEqual(calls.filter(call=>call.method==="subscription").slice(-2).map(call=>[call.args.type,call.args.active]),
      [["reply",false],["reaction",false]]);
  }finally{await process.retire(ref);delete globalThis.__reactWidgetSubscriptions;}
});

test("button overlay reopens with a fresh private message after a client-side Revert",async()=>{
  const published=[],detached=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    if(method==="detach"){detached.push(args.viewId);return null;}
    if(method!=="publish")return null;
    published.push(args);
    const privateTarget=args.target.receiverUserId
      ?{chatId:1,receiverUserId:args.target.receiverUserId,ephemeralMessageId:80+published.length}
      :{chatId:1,messageId:40};
    return {status:"confirmed",target:privateTarget,
      view:{target:privateTarget,message:args.target.receiverUserId
        ?{ephemeral_message_id:privateTarget.ephemeralMessageId,receiver_user:{id:args.target.receiverUserId}}
        :{message_id:40}}};
  }});
  const ref={widgetId:"overlay-process",botId:"b",agentId:"a",generation:1};
  try{
    await process.load(ref,{buildId:"overlay-process",snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/overlay.mjs",import.meta.url))});
    await process.mount(ref,{viewId:"v-parent",target:{chatId:1},component:"Main",props:{}});
    const token=published[0].replyMarkup.inline_keyboard[0][0].callback_data;
    const fire=id=>process.callback(ref,{viewId:"v-parent",token,
      event:{from:{id},callbackQueryId:`cb-${id}`}});
    await fire(5);
    const firstPrivate=published.find(item=>item.target.receiverUserId===5);
    assert.ok(firstPrivate,JSON.stringify(published.map(item=>item.target)));
    assert.equal(firstPrivate.target.replaceCallbackQueryMessage,true);
    assert.equal(firstPrivate.parentViewId,"v-parent");
    await fire(5); // Telegram Revert gives the bot no event; this is another public-button callback.
    assert.equal(published.filter(item=>item.target.receiverUserId===5).length,2);
    assert.deepEqual(detached,[firstPrivate.viewId]);
    assert.equal(published.at(-1).target.callbackQueryId,"cb-5");
    assert.equal(published.at(-1).target.ephemeralMessageId,undefined);
    assert.notEqual(published.at(-1).viewId,firstPrivate.viewId);
    await fire(6);
    assert.equal(published.at(-1).target.receiverUserId,6);
  }finally{await process.retire(ref);}
});

test("button on standalone hidden group view edits that message instead of sending another",async()=>{
  const published=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    if(method!=="publish")return null;
    published.push(args);
    const target={chatId:-10,receiverUserId:5,ephemeralMessageId:91};
    return {status:"confirmed",target,view:{target,
      message:{message_id:0,ephemeral_message_id:91,receiver_user:{id:5},
        chat:{id:-10,type:"supergroup"}}}};
  }});
  const ref={widgetId:"hidden-overlay",botId:"b",agentId:"a",generation:1};
  try{
    await process.load(ref,{buildId:"hidden-overlay",
      snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/overlay.mjs",import.meta.url))});
    await process.mount(ref,{viewId:"v",target:{chatId:-10,receiverUserId:5},
      component:"Main"});
    const token=published[0].replyMarkup.inline_keyboard[0][0].callback_data;
    const event=id=>({from:{id},callbackQueryId:"click",
      message:{message_id:0,ephemeral_message_id:91,chat:{id:-10,type:"supergroup"}}});
    await assert.rejects(process.callback(ref,{viewId:"v",token,event:event(6)}),
      {code:"invalid_argument"});
    await process.callback(ref,{viewId:"v",token,event:event(5)});
    assert.equal(published.length,2);
    assert.equal(published[1].viewId,"v");
    assert.equal(published[1].target.ephemeralMessageId,91);
    assert.match(JSON.stringify(published[1].body),/Player 5/);
  }finally{await process.retire(ref);}
});

test("widget requestAgent sends a JSON snapshot and resumes after an explicit agent answer",async()=>{
  const calls=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    calls.push({method,args});
    if(method==="publish")return {status:"confirmed",target:{chatId:1,messageId:7},
      view:{target:{chatId:1,messageId:7},message:{message_id:7}}};
    if(method==="beginAgentRequest")return {requestId:"request-one"};
    if(method==="waitAgentRequest")return {hint:"Try A"};
    return null;
  }});
  const ref={widgetId:"agent-request-process",botId:"b",agentId:"a",generation:1};
  try{
    await process.load(ref,{buildId:"agent-request-process",snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/agent-request.mjs",import.meta.url))});
    await process.mount(ref,{viewId:"v",target:{chatId:1},component:"Main",props:{}});
    const token=calls.find(call=>call.method==="publish").args.replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data;
    assert.ok(token);
    await process.callback(ref,{viewId:"v",token,event:{from:{id:9},callbackQueryId:"cb"}});
    assert.equal(calls.find(call=>call.method==="beginAgentRequest").args.payload.data.n,1);
    assert.deepEqual(globalThis.__reactWidgetAgentReply,{hint:"Try A"});
  }finally{await process.retire(ref);delete globalThis.__reactWidgetAgentReply;}
});

test("useTelegram invokes the scoped controller API from the current widget",async()=>{
  const calls=[];
  const process=createReactWidgetProcess({request:async(method,args)=>{
    calls.push({method,args});
    if(method==="publish")return {status:"confirmed",target:{chatId:1,messageId:7},
      view:{target:{chatId:1,messageId:7},message:{message_id:7}}};
    if(method==="api")return {messageIds:[91]};
    return null;
  }});
  const ref={widgetId:"telegram-api-process",botId:"b",agentId:"a",generation:1};
  try{
    await process.load(ref,{buildId:"telegram-api-process",snapshotPath:fileURLToPath(new URL("../fixtures/react-widgets/telegram-api.mjs",import.meta.url))});
    await process.mount(ref,{viewId:"v",target:{chatId:1},component:"Main",props:{}});
    const token=calls.find(call=>call.method==="publish").args.replyMarkup.inline_keyboard[0][0].callback_data;
    await process.callback(ref,{viewId:"v",token,event:{from:{id:9},callbackQueryId:"cb"}});
    const invoked=calls.find(call=>call.method==="api");
    assert.equal(invoked.args.ref.widgetId,ref.widgetId);
    assert.equal(invoked.args.name,"send");
    assert.deepEqual(invoked.args.args,{text:"from widget"});
    assert.deepEqual(globalThis.__reactWidgetTelegramResult,{messageIds:[91]});
  }finally{await process.retire(ref);delete globalThis.__reactWidgetTelegramResult;}
});
