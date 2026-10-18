import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentQueue} from '../../src/agents/queue.mjs';

test('a synchronous durable marker commits after RAM reservation and before dispatch',async()=>{
  const seen=[],q=new AgentQueue({dispatch:async(_id,events)=>seen.push(...events)}),event={eventId:'e'};
  const result=q.enqueueCommitted('a',event,'inline_button',()=>true,()=>{assert.equal(q.pending('a'),1);assert.equal(seen.length,0);});
  assert.equal(result,'accepted');await q.idle();assert.deepEqual(seen,[event]);
});
test('marker failure rolls back the RAM item and never dispatches it',async()=>{
  const q=new AgentQueue({dispatch:async()=>assert.fail('Must not dispatch')});
  assert.throws(()=>q.enqueueCommitted('a',{eventId:'e'},'inline_button',()=>true,()=>{throw new Error('disk');}),/disk/);
  assert.equal(q.pending('a'),0);await q.idle();
});
test('superseding a pending inline request preserves other input and rechecks selected items before dispatch',async()=>{
  let live=true;const batches=[],q=new AgentQueue({dispatch:async(_id,events)=>batches.push(events)});
  q.setPaused('a',true);q.enqueue('a',{eventType:'inline',requestId:'old'},'inline',()=>live);q.enqueue('a',{eventType:'message'},'chat');
  q.cancelWhere('a',event=>event.eventType==='inline');assert.equal(q.pending('a'),1);q.setPaused('a',false);await q.idle();assert.equal(batches[0][0].eventType,'message');
  q.enqueue('a',{eventType:'inline',requestId:'selected'},'inline',()=>live);live=false;await q.idle();assert.equal(batches.length,1);
});
