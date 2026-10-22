import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentQueue} from '../../src/agents/queue.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(t, options = {}) {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const batches = [];
  const queue = new AgentQueue({dispatch:async (id, events) => batches.push({id,events}),...options});
  t.after(() => queue.close());
  const advance = async ms => { t.mock.timers.tick(ms); await flush(); };
  return {queue,batches,advance};
}

test('all event sources share a fixed 200ms window, independently for each agent', async t => {
  const {queue:q,batches,advance} = fixture(t);
  assert.equal(q.canStart('a'),true);
  q.enqueue('a',{n:1},'chat');
  assert.equal(q.canStart('a'),false);
  await flush(); assert.deepEqual(batches, []);
  await advance(50); q.enqueue('a',{n:2},'schedule');
  await advance(50); q.enqueue('b',{n:3},'agent');
  await advance(50); q.enqueue('a',[{n:4},{n:5}],'websocket');
  await advance(49); assert.deepEqual(batches, []);
  await advance(1);
  assert.deepEqual(batches, [{id:'a',events:[{n:1},{n:2},{n:4},{n:5}]}]);
  await advance(100);
  assert.deepEqual(batches.at(-1), {id:'b',events:[{n:3}]});
  await q.idle();
  assert.equal(q.canStart('a'),true);
});

test('time spent busy counts toward the pending batch window', async t => {
  let finish;
  const root = new Promise(resolve => { finish = resolve; });
  const batches = [];
  const {queue:q,advance} = fixture(t,{dispatch:async (_id,events) => { batches.push(events); if(batches.length===1)await root; }});
  t.after(finish);
  q.enqueue('a',{n:1},'chat'); await advance(200);
  q.enqueue('a',{n:2},'inline'); await advance(200);
  assert.deepEqual(batches, [[{n:1}]]);
  finish(); await flush();
  assert.deepEqual(batches, [[{n:1}],[{n:2}]]);
  await q.idle();
});

test('a recognized root wait steers one complete batch without extending its window', async t => {
  let finish;
  const root = new Promise(resolve => { finish = resolve; });
  const steered = [];
  const {queue:q,advance} = fixture(t,{dispatch:()=>root,steer:async (_id,events)=>steered.push(events)});
  t.after(finish);
  q.enqueue('a',{n:1},'chat'); await advance(200);
  q.setWaiting('a',true);
  q.enqueue('a',{n:2},'guest'); await advance(150);
  q.enqueue('a',{n:3},'chat'); await advance(49);
  assert.deepEqual(steered, []);
  await advance(1);
  assert.deepEqual(steered, [[{n:2},{n:3}]]);
  finish(); await q.idle();
});

test('clear, cancellation and close cancel batch timers and release idle waiters', async t => {
  const {queue:q,batches,advance} = fixture(t);
  q.enqueue('a',{n:1},'chat');
  const idle = q.idleAgent('a');
  q.clear('a'); await idle;
  await advance(100);
  q.enqueue('a',{n:2},'chat');
  assert.equal(q.cancelWhere('a',()=>true),1);
  await q.idle();
  q.enqueue('a',{n:3},'chat'); await advance(199);
  assert.deepEqual(batches, []);
  await advance(1); assert.deepEqual(batches, [{id:'a',events:[{n:3}]}]);
  q.enqueue('a',{n:4},'chat'); const closing=q.idle();
  q.close(); await closing; await advance(200);
  assert.equal(batches.length,1);
});

test('commits happen immediately, with admission rechecked at the batch deadline', async t => {
  let admitted = true, committed = false;
  const dropped = [];
  const {queue:q,batches,advance} = fixture(t,{onDropped:(_id,event)=>dropped.push(event)});
  assert.equal(q.enqueueCommitted('a',{n:1},'chat',()=>admitted,()=>{committed=true;}),'accepted');
  assert.equal(committed,true);
  assert.deepEqual(batches, []);
  admitted=false; await advance(200);
  assert.deepEqual(batches, []); assert.deepEqual(dropped,[{n:1}]);
  assert.throws(()=>q.enqueueCommitted('a',{n:2},'chat',undefined,()=>{throw new Error('commit failed');}),/commit failed/);
  await q.idle(); assert.equal(q.pending('a'),0);
});

test('a full collecting batch evicts oldest chat events without delaying other sources', async t => {
  const {queue:q,batches,advance} = fixture(t);
  for(let n=0;n<10;n++)assert.equal(q.enqueue('a',{n},'chat'),'accepted');
  assert.equal(q.enqueue('a',{n:10},'chat'),'accepted');
  assert.equal(q.enqueue('a',{n:11},'schedule'),'accepted');
  await advance(200);
  assert.equal(batches.length,1);
  assert.deepEqual(batches[0].events.map(event=>event.n),[1,2,3,4,5,6,7,8,9,10,11]);
});

test('a Telegram burst reaches the controller agent in one batch with edits applied', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const db=openDatabase(':memory:'),batches=[];
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  const controller=createController({db,telegram:{call:async()=>true},agent:{run:async(_scope,events)=>batches.push(events)}});
  t.after(async()=>{controller.close();await controller.idle();db.close();});
  const message=(id,text)=>({message_id:id,date:1,chat:{id:1,type:'private'},from:{id:1},text});
  await controller.receive('b',{message:message(1,'first')});
  t.mock.timers.tick(100);
  await controller.receive('b',{message:message(2,'second')});
  await controller.receive('b',{edited_message:{...message(1,'corrected'),edit_date:2}});
  t.mock.timers.tick(99);await flush();assert.deepEqual(batches,[]);
  await controller.receive('b',{message:message(3,'third')});
  t.mock.timers.tick(1);await controller.idle();
  assert.deepEqual(batches.map(events=>events.map(e=>[e.messageId,e.textPlain])),[[[1,'corrected'],[2,'second'],[3,'third']]]);
});
