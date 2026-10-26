import test from "node:test";
import assert from "node:assert/strict";
import {WIDGET_TOOL_SCHEMAS} from "../../src/widgets/contract.mjs";
import {WIDGET_API_METHODS} from "../../src/widgets/api.mjs";
import {dynamicTools} from "../../src/codex/threads.mjs";
import {openDatabase} from "../../src/storage/database.mjs";
import {createController} from "../../src/controller.mjs";

test("agent widget tools expose React components and store updates, not legacy hooks",()=>{
  assert.ok(WIDGET_TOOL_SCHEMAS.create_widget.properties.props);
  assert.equal(WIDGET_TOOL_SCHEMAS.create_widget.properties.state,undefined);
  assert.ok(WIDGET_TOOL_SCHEMAS.set_widget_view.properties.component);
  assert.ok(WIDGET_TOOL_SCHEMAS.set_widget_view.properties.viewId);
  assert.ok(WIDGET_TOOL_SCHEMAS.update_widget_store.properties.state);
  assert.deepEqual(WIDGET_TOOL_SCHEMAS.dispatch_widget_action.required,["widgetId","action"]);
  assert.ok(WIDGET_TOOL_SCHEMAS.dispatch_widget_action.properties.args);
  assert.equal(WIDGET_TOOL_SCHEMAS.widget_event,undefined);
  assert.match(dynamicTools.find(tool=>tool.name==="dispatch_widget_action")?.description??"",/Telegram repaint/);
});

test("Runtime WebSocket capabilities use the same scoped agent API",()=>{
  for(const method of ["ws_open","ws_list","ws_pull","ws_send","ws_close","ws_delete"])
    assert.ok(WIDGET_API_METHODS.has(method),method);
});

test("controller routes a named widget action through the authenticated agent tool",async t=>{
  const db=openDatabase(":memory:");
  db.registerBot({botId:"b",telegramId:42,username:"bot",ownerId:1});
  db.saveChat("b",{id:1,type:"private"});
  const agentScope=db.ensureAgent("b",1),calls=[];
  const widgets={react:true,recover:async()=>{},close:async()=>{},
    withTarget:(_bot,_target,fn)=>fn(),
    dispatchAction:async(scope,args)=>{calls.push({scope,args});return {updatedViews:[]};}};
  const controller=createController({db,widgetService:widgets,
    telegram:{call:async()=>({})},
    agent:{run:async()=>{},models:async()=>[],deleteSession:async()=>{}}});
  t.after(async()=>{await controller.close();db.close();});
  await controller.ready;
  const result=await controller.invoke(controller.lifecycle.scope(agentScope),
    "dispatch_widget_action",{widgetId:"w1",action:"finishRound",args:{}});
  assert.deepEqual(result,{updatedViews:[]});
  assert.equal(calls.length,1);
  assert.equal(calls[0].scope.agentId,agentScope.agentId);
  assert.deepEqual(calls[0].args,{widgetId:"w1",action:"finishRound",args:{}});
});
