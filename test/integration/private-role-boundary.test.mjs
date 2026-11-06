import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {createWidgetStore} from '../../src/widgets/store.mjs';

function fixture(t,{authorized=false}={}){
  const db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  const chat={id:2,type:'private',first_name:'Before'};
  db.saveChat('b',chat);if(authorized)db.setRole('b',2,'user');
  const agent=db.ensureAgent('b',2),store=createWidgetStore(db),calls=[],events=[],batches=[];
  const widget=store.create({botId:'b',agentId:agent.agentId,handler:'x.tsx',description:'Widget'});
  const viewId=`v${'a'.repeat(32)}`,token=`w:${viewId}:${'b'.repeat(16)}`;
  store.createView(widget,{id:viewId,target:{chatId:2,messageId:7},exportName:'Main',props:{},
    projection:{body:{rich_message:{blocks:[{type:'paragraph',text:'Hello'}]}},
      replyMarkup:{inline_keyboard:[[{text:'Click',callback_data:token}]]}}});
  const widgetService={react:true,store,recover:async()=>{},close:async()=>{},idle:async()=>{},
    hasSubscription:()=>true,dispatchCallback:async()=>events.push('callback'),
    dispatchViewEvent:async()=>events.push('event')};
  const telegram={call:async(_bot,method,args)=>{calls.push({method,args});if(method==='editMessageReplyMarkup')return {...db.getMessage('b',args.chat_id,args.message_id),reply_markup:args.reply_markup};return true;}};
  const controller=createController({db,telegram,widgetService,clock:()=>100000,config:{},
    agent:{run:async(_scope,batch)=>batches.push(batch)}});
  t.after(async()=>{controller.close();await controller.idle();db.close();});
  return {db,chat,agent,controller,calls,events,batches,token,store,widget};
}

test('a user without a role cannot send private messages or commands to the agent',async t=>{
  const f=fixture(t),chat={...f.chat,first_name:'Changed'};
  const from={id:2,first_name:'User'};
  const message=(text,id)=>({message_id:id,date:100,chat,from,text});
  const before=f.db.getChat('b',2).json;
  for(const [index,text] of ['/say hello','/help','/start','/browse','/user set 2 admin','hello'].entries())
    await f.controller.receive('b',{message:message(text,index+1)});
  await f.controller.receive('b',{edited_message:{...message('/say edited',20),edit_date:101}});
  await f.controller.receive('b',{message:{...message('',21),document:{file_id:'f',file_unique_id:'u',file_name:'x'}}});
  await f.controller.receive('b',{message:{...message('reply',22),reply_to_message:{message_id:7}}});
  await f.controller.idle();
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);assert.deepEqual(f.batches,[]);
  assert.equal(f.db.getChat('b',2).json,before);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM messages').get().n,0);
});

test('widget clicks and reactions from a user without a role keep working in private chats',async t=>{
  const f=fixture(t),from={id:2};
  await f.controller.receive('b',{callback_query:{id:'c',from,data:f.token,message:{message_id:7,date:100,chat:f.chat}}});
  await f.controller.receive('b',{message_reaction:{chat:f.chat,message_id:7,user:from,old_reaction:[],new_reaction:[{type:'emoji',emoji:'👍'}]}});
  await f.controller.idle();assert.deepEqual(f.events,['callback','event']);assert.deepEqual(f.batches,[]);
});

test('both the owner and a recipient without a role can click an inline widget',async t=>{
  const f=fixture(t),id=`v${'c'.repeat(32)}`,token=`w:${id}:${'d'.repeat(16)}`;
  f.store.createView(f.widget,{id,target:{inlineMessageId:'inline-id'},exportName:'Main',props:{},
    projection:{body:{rich_message:{blocks:[{type:'paragraph',text:'Hello'}]}},replyMarkup:{inline_keyboard:[[{text:'Click',callback_data:token}]]}}});
  for(const user of [1,2])await f.controller.receive('b',{callback_query:{id:`c${user}`,from:{id:user},data:token,inline_message_id:'inline-id'}});
  await f.controller.idle();assert.deepEqual(f.events,['callback','callback']);assert.deepEqual(f.batches,[]);
});

test('a queued private message is not delivered after its author loses the role',async t=>{
  const f=fixture(t,{authorized:true});f.controller.queue.setPaused(f.agent.agentId,true);
  await f.controller.receive('b',{message:{message_id:30,date:100,chat:f.chat,from:{id:2},text:'hello'}});
  assert.equal(f.controller.queue.pending(f.agent.agentId),1);
  f.db.sql.prepare('DELETE FROM roles WHERE botId=? AND userId=?').run('b',2);
  f.controller.queue.setPaused(f.agent.agentId,false);await f.controller.idle();
  assert.deepEqual(f.batches,[]);
});

test('a queued private button is restored and not delivered after its author loses the role',async t=>{
  const f=fixture(t,{authorized:true});f.controller.queue.setPaused(f.agent.agentId,true);
  const stored={message_id:8,date:100,chat:f.chat,text:'Choose',reply_markup:{inline_keyboard:[[{text:'Choice',callback_data:'[g]choice'}]]}};
  f.db.saveMessage('b',stored);
  await f.controller.receive('b',{callback_query:{id:'button',from:{id:2},message:stored,data:'[g]choice'}});
  assert.equal(f.controller.queue.pending(f.agent.agentId),1);
  f.db.sql.prepare('DELETE FROM roles WHERE botId=? AND userId=?').run('b',2);
  f.controller.queue.setPaused(f.agent.agentId,false);await f.controller.idle();
  assert.deepEqual(f.batches,[]);
  assert.equal(f.db.getMessage('b',2,8).reply_markup.inline_keyboard[0][0].callback_data,'[g]choice');
});
