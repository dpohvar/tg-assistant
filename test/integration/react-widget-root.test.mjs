import test from "node:test";
import assert from "node:assert/strict";
import React,{createContext,useContext,useEffect,useRef,useState} from "react";
import * as runtimeModule from "../../src/widgets/reconciler.mjs";
import { useViews,useSelector,useView } from "../../src/widgets/react-context.mjs";
import { useOnReply } from "../../src/widgets/subscriptions.mjs";

const h=React.createElement;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test("private chat overlay is a virtual child of one retained message view",async()=>{
  function Launcher(){return h("p",null,"Launch");}
  function Game(){const view=useView();return h("p",null,
    `Game for ${view.user?.id} under ${view.parent?.id}`);}
  const published=[];
  const runtime=runtimeModule.createReactRuntime({bridge:{commit:async(_id,roots,_revision,views)=>{
    const rootsForView=roots.filter(node=>node.type==="widget-view"&&node.props.viewId==="v");
    published.push({roots:rootsForView.map(node=>node.props.role),views:[...views.keys()]});
    return {updatedViews:[],failedViews:[]};
  }}});
  await runtime.create({widgetId:"private-overlay",buildId:"private-overlay",
    factory:()=>({Launcher,Game})});
  const parent=await runtime.mount({widgetId:"private-overlay",viewId:"v",
    target:{chatId:1,messageId:7},component:"Launcher"});
  const child=await runtime.mount({widgetId:"private-overlay",viewId:"virtual",
    target:parent.target,parentViewId:parent.id,user:{id:1},node:h(Game),
    virtual:true,origin:"runtime"});
  assert.equal(child.user.id,1);
  assert.equal(child.parent.id,parent.id);
  assert.equal(runtime.activeView("private-overlay","v").id,"virtual");
  assert.deepEqual(published.at(-1).roots,["parent","overlay"]);
  assert.deepEqual(published.at(-1).views,["v","virtual"]);
  await child.closeOverlay();
  assert.equal(runtime.activeView("private-overlay","v").id,"v");
  assert.deepEqual(published.at(-1).roots,["parent"]);
  await runtime.retire("private-overlay");
});

test("standalone group ephemeral view can host a virtual child in the same hidden message",async()=>{
  function Launcher(){return h("p",null,"Launch");}
  function Game(){const view=useView();return h("p",null,
    `Game for ${view.user?.id} under ${view.parent?.id}`);}
  const published=[];
  const runtime=runtimeModule.createReactRuntime({bridge:{commit:async(_id,roots,_revision,views)=>{
    published.push({roles:roots.filter(node=>node.type==="widget-view")
      .map(node=>node.props.role),ids:[...views.keys()]});
    return {updatedViews:[],failedViews:[]};
  }}});
  await runtime.create({widgetId:"hidden-game",buildId:"hidden-game",
    factory:()=>({Launcher,Game})});
  const target={chatId:-10,receiverUserId:5,ephemeralMessageId:91};
  const parent=await runtime.mount({widgetId:"hidden-game",viewId:"v",
    target,component:"Launcher"});
  const child=await runtime.mount({widgetId:"hidden-game",viewId:"virtual",
    target,parentViewId:parent.id,user:{id:5},node:h(Game),virtual:true,origin:"runtime"});
  assert.equal(child.parent.id,parent.id);
  assert.deepEqual(published.at(-1),{roles:["parent","overlay"],ids:["v","virtual"]});
  await child.closeOverlay();
  assert.equal(runtime.activeView("hidden-game","v").id,"v");
  assert.deepEqual(published.at(-1),{roles:["parent"],ids:["v"]});
  await runtime.retire("hidden-game");
});

test("an unchanged private parent keeps its overlay, but a changed parent closes it",async()=>{
  function Launcher(){const label=useSelector(state=>state.label);return h("p",null,label);}
  function Game(){return h("p",null,"game");}
  const runtime=runtimeModule.createReactRuntime({bridge:{commit:async()=>({updatedViews:[],failedViews:[]})}});
  await runtime.create({widgetId:"private-refresh",buildId:"private-refresh",
    factory:()=>({Launcher,Game}),saved:{version:0,revision:0,state:{label:"start",count:0}}});
  const parent=await runtime.mount({widgetId:"private-refresh",viewId:"v",
    target:{chatId:1,messageId:7},component:"Launcher"});
  await runtime.mount({widgetId:"private-refresh",viewId:"virtual",target:parent.target,
    parentViewId:parent.id,user:{id:1},node:h(Game),virtual:true,origin:"runtime"});
  await runtime.replaceStore("private-refresh",{label:"start",count:1});
  assert.equal(runtime.activeView("private-refresh","v").id,"virtual");
  await runtime.replaceStore("private-refresh",{label:"finished",count:1});
  assert.equal(runtime.activeView("private-refresh","v").id,"v");
  assert.equal(runtime.describe("private-refresh","v").tree.children[0].children[0].text,"finished");
  await runtime.retire("private-refresh");
});

test("reply subscriptions follow the visible private overlay and return to its parent",async()=>{
  const delivered=[],subscriptions=[];
  function Launcher(){useOnReply(()=>delivered.push("parent"));return h("p",null,"Launch");}
  function Game(){useOnReply(()=>delivered.push("game"));return h("p",null,"Game");}
  const runtime=runtimeModule.createReactRuntime({bridge:{
    subscription:(_widgetId,viewId,type,active)=>subscriptions.push({viewId,type,active}),
    commit:async()=>({updatedViews:[],failedViews:[]}),
  }});
  await runtime.create({widgetId:"reply-overlay",buildId:"reply-overlay",
    factory:()=>({Launcher,Game})});
  const parent=await runtime.mount({widgetId:"reply-overlay",viewId:"v",
    target:{chatId:1,messageId:7},component:"Launcher"});
  await runtime.dispatchViewEvent("reply-overlay","v","reply",{});
  const child=await runtime.mount({widgetId:"reply-overlay",viewId:"virtual",target:parent.target,
    parentViewId:parent.id,user:{id:1},node:h(Game),virtual:true,origin:"runtime"});
  await runtime.dispatchViewEvent("reply-overlay","v","reply",{});
  await child.closeOverlay();
  await runtime.dispatchViewEvent("reply-overlay","v","reply",{});
  assert.deepEqual(delivered,["parent","game","parent"]);
  assert.equal(subscriptions.at(-1).active,true);
  assert.ok(subscriptions.every(item=>item.viewId==="v"&&item.type==="reply"));
  await runtime.retire("reply-overlay");
});

test("named action publishes saved state and reports only confirmed view edits",async()=>{
  function Main(){const count=useSelector(state=>state.count);return h("p",null,String(count));}
  const edits=[];
  const runtime=runtimeModule.createReactRuntime({bridge:{
    storeRevision:async(_id,revision)=>edits.push(`saved:${revision.revision}`),
    commit:async(_id,_roots,revision,views)=>{
      edits.push(`published:${revision}`);
      return {updatedViews:[...views.values()].map(view=>({viewId:view.id,target:view.target})),failedViews:[]};
    },
  }});
  await runtime.create({widgetId:"actions",buildId:"actions",factory:()=>({Main,
    add:({amount})=>state=>{state.count+=amount;},
    noop:()=>state=>{state.count+=0;},
    invalid:()=>({count:99}),
  }),saved:{version:0,revision:2,state:{count:1}}});
  await runtime.mount({widgetId:"actions",viewId:"v",target:{chatId:1,messageId:7},component:"Main"});
  edits.length=0;
  const result=await runtime.dispatchAction("actions","add",{amount:2});
  assert.deepEqual(result,{updatedViews:[{viewId:"v",target:{chatId:1,messageId:7}}]});
  assert.equal(runtime.state("actions").state.count,3);
  assert.ok(edits.indexOf("saved:3")<edits.indexOf("published:3"));
  await assert.rejects(runtime.dispatchAction("actions","Missing",{}),{code:"invalid_argument"});
  await assert.rejects(runtime.dispatchAction("actions","invalid",{}),{code:"invalid_argument"});
  assert.equal(runtime.state("actions").state.count,3);
  await runtime.retire("actions");
});

test("store operation rejects a failed view publication with partial results",async()=>{
  function Main(){const count=useSelector(state=>state.count);return h("p",null,String(count));}
  let fail=false;
  const runtime=runtimeModule.createReactRuntime({bridge:{commit:async(_id,_roots,_revision,views)=>{
    if(!fail)return {updatedViews:[],failedViews:[]};
    return {updatedViews:[{viewId:"a",target:views.get("a").target}],
      failedViews:[{viewId:"b",error:{code:"MESSAGE_NOT_FOUND",message:"gone"}}]};
  }}});
  await runtime.create({widgetId:"partial",buildId:"partial",factory:()=>({Main}),
    saved:{version:0,revision:0,state:{count:1}}});
  await runtime.mount({widgetId:"partial",viewId:"a",target:{chatId:1,messageId:1},component:"Main"});
  await runtime.mount({widgetId:"partial",viewId:"b",target:{chatId:1,messageId:2},component:"Main"});
  fail=true;
  await assert.rejects(runtime.replaceStore("partial",{count:2}),error=>{
    assert.equal(error.code,"view_render_failed");
    assert.deepEqual(error.updatedViews,[{viewId:"a",target:{chatId:1,messageId:1}}]);
    assert.equal(error.failedViews[0].viewId,"b");
    return true;
  });
  assert.equal(runtime.state("partial").state.count,2);
  await runtime.retire("partial");
});

test("restored view keeps its binding and repaints after store replacement",async()=>{
  function Main(){const count=useSelector(state=>state.count);return h("p",null,String(count));}
  let publishedEpoch;
  const runtime=runtimeModule.createReactRuntime({bridge:{commit:(_id,_roots,_revision,views)=>{
    publishedEpoch=views.get("v")?.bindingEpoch;
  }}});
  await runtime.create({widgetId:"restored",buildId:"saved",factory:()=>({Main}),
    saved:{version:0,revision:3,state:{count:10}}});
  await runtime.mount({widgetId:"restored",viewId:"v",target:{chatId:1,messageId:7},
    component:"Main",bindingEpoch:"ePersisted"});
  assert.equal(publishedEpoch,"ePersisted");
  assert.equal(runtime.describe("restored","v").tree.children[0].children[0].text,"10");
  await runtime.replaceStore("restored",{count:11});
  await tick();
  assert.equal(runtime.describe("restored","v").tree.children[0].children[0].text,"11");
  await runtime.retire("restored");
});

test("one real React root retains hooks and Runtime context across view prop updates", async () => {
  assert.equal(typeof runtimeModule.createReactRuntime,"function");
  const Context=createContext(null),events=[];
  function Runtime({children}) { const ref=useRef({token:"shared"});useEffect(()=>{events.push("runtime mount");return()=>events.push("runtime cleanup")},[]);return h(Context,{value:ref.current},children); }
  function Main({label}) {const shared=useContext(Context),[count,setCount]=useState(0);useEffect(()=>{events.push(`view mount ${label}`);return()=>events.push(`view cleanup ${label}`)},[]);return h("p",{onClick:()=>setCount(x=>x+1)},`${label}:${count}:${shared.token}`);}
  const runtime=runtimeModule.createReactRuntime();
  await runtime.create({widgetId:"w",buildId:"b",factory:()=>({default:Runtime,Main})});
  const view=await runtime.mount({widgetId:"w",viewId:"v",target:{chatId:1,messageId:1},component:"Main",props:{label:"A"}});
  await tick();
  assert.equal(runtime.describe("w","v").tree.children[0].children[0].text,"A:0:shared");
  runtime.describe("w","v").tree.children[0].props.onClick();
  await tick();
  assert.equal(runtime.describe("w","v").tree.children[0].children[0].text,"A:1:shared");
  await view.mount(h(Main,{label:"B"}));
  await tick();
  assert.equal(runtime.describe("w","v").tree.children[0].children[0].text,"B:1:shared");
  await view.mount(h(Main,{label:"C"}),{force:true});
  await tick();
  assert.equal(runtime.describe("w","v").tree.children[0].children[0].text,"C:0:shared");
  assert.equal(events.filter(x=>x==="runtime mount").length,1);
  await runtime.retire("w");
  assert.ok(events.includes("runtime cleanup"));
});

test("default Runtime is optional, useViews stabilizes and a failing view can recover", async () => {
  const events=[];
  function Good({label}) {const views=useViews();return h("p",null,`${label}:${views.length}`);}
  function Bad(){throw Error("render boom");}
  const runtime=runtimeModule.createReactRuntime({bridge:{viewError:(widgetId,viewId)=>events.push(viewId)}});
  await runtime.create({widgetId:"plain",buildId:"plain",factory:()=>({Good,Bad})});
  const good=await runtime.mount({widgetId:"plain",viewId:"good",target:{chatId:1,messageId:1},component:"Good",props:{label:"ok"}});
  assert.equal(runtime.describe("plain","good").tree.children[0].children[0].text,"ok:1");
  await runtime.mount({widgetId:"plain",viewId:"bad",target:{chatId:1,messageId:2},component:"Bad"});
  await tick();
  assert.equal(runtime.describe("plain","bad").status,"error");
  assert.deepEqual(events,["bad"]);
  assert.equal(runtime.describe("plain","good").tree.children[0].children[0].text,"ok:2");
  await good.mount();
  assert.equal(runtime.describe("plain","good").tree.children[0].children[0].text,"ok:2");
  await runtime.retire("plain");
});

test("Runtime can run with no views and sibling widget roots keep state separate", async () => {
  const Context=createContext(null),events=[];
  function Runtime({children}) { useEffect(()=>{events.push("open");return()=>events.push("close")},[]);return h(Context,{value:{}},children); }
  function Main() { const [n,setN]=useState(0);useContext(Context);return h("p",{onClick:()=>setN(n+1)},String(n)); }
  const runtime=runtimeModule.createReactRuntime();
  await runtime.create({widgetId:"a",buildId:"shared",factory:()=>({default:Runtime,Main})});
  await runtime.create({widgetId:"b",buildId:"shared",factory:()=>{throw Error("recompiled")}});
  await tick();
  assert.equal(events.length,2);
  const va=await runtime.mount({widgetId:"a",viewId:"va",target:{chatId:1,messageId:1},component:"Main"});
  await runtime.mount({widgetId:"b",viewId:"vb",target:{chatId:1,messageId:2},component:"Main"});
  runtime.describe("a","va").tree.children[0].props.onClick();
  await tick();
  assert.equal(runtime.describe("a","va").tree.children[0].children[0].text,"1");
  assert.equal(runtime.describe("b","vb").tree.children[0].children[0].text,"0");
  await va.unmount();
  await tick();
  assert.equal(events.filter(x=>x==="close").length,0);
  await runtime.retire("a");
  await runtime.retire("b");
  assert.equal(events.filter(x=>x==="close").length,2);
});
