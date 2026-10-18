import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';
import {createInlineEvents} from '../../src/inline/events.mjs';
import {AgentQueue} from '../../src/agents/queue.mjs';
import {createWidgetStore} from '../../src/widgets/store.mjs';
function fixture(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1),owner={botId:'b',agentId:a.agentId,chatId:1},store=createInlineStore(db),widgets={store:createWidgetStore(db)},queued=[],acks=[];
  let enabled=true;const queue=new AgentQueue({dispatch:async(_id,events)=>queued.push(...events)}),events=createInlineEvents({store,widgets,queue,resolveOwner:()=>enabled?owner:null,telegram:{call:async(_b,_m,args)=>acks.push(args)}});
  store.registerPage(owner,[{native:{type:'article',id:'r'},definitions:[{btnId:'one',tipId:'tip',key:'go',group:'start',callbackKey:'[start]go',action:'Activate Wordle',permits:null}]}]);
  const callback=(id='cb',userId=2)=>({id,from:{id:userId,first_name:'Clicker'},inline_message_id:'inline-one',data:'i:one'});
  return {db,owner,store,widgets,queue,events,queued,acks,callback,disable:()=>enabled=false};
}
test('a grouped public click routes to the preparing agent and queued events never replay',async t=>{
  const f=fixture(t);await f.events.receive('b',f.callback());await f.events.receive('b',f.callback('other',3));await f.queue.idle();
  assert.equal(f.queued.length,1);assert.equal(f.queued[0].from.userId,2);assert.equal(f.store.pendingEvents().length,0);
  await f.events.receive('b',f.callback());await f.events.drain();await f.queue.idle();assert.equal(f.queued.length,1);assert.equal(f.acks.length,3);
});
test('disabled preparing agent cannot consume the group or receive a click',async t=>{
  const f=fixture(t);f.disable();await f.events.receive('b',f.callback());assert.ok(f.store.button('b','one'));assert.equal(f.store.pendingEvents().length,0);assert.equal(f.queued.length,0);
});
test('an old action token on a widget-owned message cannot invoke the agent',async t=>{
  const f=fixture(t),w=f.widgets.store.create({...f.owner,handler:'a.tsx',snapshotId:'s',description:'Wordle'});f.widgets.store.createView(w,{target:{inlineMessageId:'inline-one'}});
  await f.events.receive('b',f.callback());assert.equal(f.queued.length,0);assert.ok(f.store.button('b','one'));
});
test('failed queue marker retains one durable pending event for a later admissible drain',async t=>{
  const f=fixture(t),mark=f.store.markQueued;f.store.markQueued=()=>{throw new Error('synthetic disk failure');};
  await f.events.receive('b',f.callback());assert.equal(f.queue.pending(f.owner.agentId),0);assert.equal(f.queued.length,0);assert.equal(f.store.pendingEvents().length,1);
  f.store.markQueued=mark;await f.events.drain();await f.queue.idle();assert.equal(f.queued.length,1);assert.equal(f.store.pendingEvents().length,0);
});
