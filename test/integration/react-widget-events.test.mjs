import test from "node:test";
import assert from "node:assert/strict";
import {openDatabase} from "../../src/storage/database.mjs";
import {createWidgetStore} from "../../src/widgets/store.mjs";
import {createWidgetEvents} from "../../src/widgets/events.mjs";

test("React callback routes unknown inline participant by current token without binding its address",async()=>{
  const db=openDatabase(":memory:");
  try{
    db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
    db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
    db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
    const store=createWidgetStore(db);
    const widget=store.create({botId:"b",agentId:"a",handler:"x.tsx",buildId:"x",description:"x"});
    const token=`w:v${"a".repeat(32)}:${"b".repeat(16)}`;
    const view=store.createView(widget,{id:`v${"a".repeat(32)}`,target:{inlineMessageId:"canonical"},
      exportName:"Main",props:{},projection:{body:{rich_message:{blocks:[{type:"paragraph",text:"x"}]}},
        replyMarkup:{inline_keyboard:[[{text:"Press",callback_data:token}]]}}});
    const calls=[],answers=[];
    const manager={react:true,store,dispatchCallback:async(...args)=>calls.push(args)};
    const events=createWidgetEvents({db,manager,telegram:{call:async(_bot,method,args)=>answers.push({method,args})}});
    assert.equal(await events("b",{callback_query:{id:"c1",data:token,from:{id:7},inline_message_id:"participant-7"}}),true);
    assert.equal(calls.length,1);
    assert.equal(calls[0][1].id,view.id);
    assert.equal(store.byTarget("b",{inlineMessageId:"participant-7"}),null);
    const other=store.create({botId:"b",agentId:"a",handler:"x.tsx",buildId:"x",description:"other"});
    store.createView(other,{target:{inlineMessageId:"participant-8"},exportName:"Main",props:{}});
    assert.equal(await events("b",{callback_query:{id:"c2",data:token,from:{id:8},inline_message_id:"participant-8"}}),true);
    assert.equal(calls.length,1);
    assert.equal(answers.length,1);
    assert.equal(await events("other-bot",{callback_query:{id:"c3",data:token,from:{id:9},inline_message_id:"canonical"}}),false);
  }finally{db.close();}
});

test("an active reply hook owns the reply; disabled hooks leave normal routing intact",async()=>{
  const db=openDatabase(":memory:");
  try{
    db.sql.prepare("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',1,'bot',5)").run();
    db.sql.prepare("INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',-10,'supergroup','g','{}')").run();
    db.sql.prepare("INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',-10,'test',1)").run();
    const store=createWidgetStore(db),widget=store.create({botId:"b",agentId:"a",handler:"x.tsx",buildId:"x",description:"x"});
    const view=store.createView(widget,{target:{chatId:-10,messageId:25},exportName:"Main",props:{}});
    const routed=[],active=new Set();
    const manager={react:true,store,hasSubscription:(v,type)=>v.id===view.id&&active.has(type),
      dispatchViewEvent:async(...args)=>routed.push(args)};
    const events=createWidgetEvents({db,manager,telegram:{call:async()=>{}}});
    const reply={message:{chat:{id:-10},message_id:26,from:{id:7},reply_to_message:{message_id:25}}};
    assert.equal(await events("b",reply),false);
    active.add("reply");
    assert.equal(await events("b",reply),true);
    assert.equal(routed[0][2],"reply");
    assert.equal(routed[0][3].from.id,7);
    const reaction={message_reaction:{chat:{id:-10},message_id:25,user:{id:8},old_reaction:[],new_reaction:[{type:"emoji",emoji:"👍"}]}};
    assert.equal(await events("b",reaction),false);
    active.add("reaction");
    assert.equal(await events("b",reaction),true);
    assert.equal(routed[1][3].from.id,8);
    assert.equal(await events("b",{message_reaction_count:{chat:{id:-10},message_id:25}}),false);
  }finally{db.close();}
});
