import {test} from 'node:test';import assert from 'node:assert/strict';import {AgentQueue} from '../../src/agents/queue.mjs';
test('overflow evicts oldest chat only after successful synchronous commit without moving deadline',()=>{
 const evicted=[],q=new AgentQueue({dispatch:()=>{},onEvicted:(_id,e)=>evicted.push(e)});q.setHeld('a','test',true);
 try{q.enqueue('a',{n:'service'},'schedule');for(let n=0;n<10;n++)q.enqueue('a',{n},'chat');const deadline=q.state('a').events[0].readyAt;
 assert.throws(()=>q.enqueueCommitted('a',{n:10},'chat',null,()=>{throw Error('storage');}));assert.equal(q.pending('a'),11);assert.equal(evicted.length,0);
 q.enqueue('a',{n:10},'chat');assert.deepEqual(evicted,[{n:0}]);assert.equal(q.state('a').events[0].event.n,'service');assert.equal(q.state('a').events.at(-1).readyAt,deadline);assert.equal(q.pending('a'),11);
 }finally{q.close();}
});
test('compact boundary allows prefix only and idleActive does not wait on held pending items',async()=>{
 const seen=[],q=new AgentQueue({dispatch:(_id,e)=>seen.push(e)});q.setHeld('a','test',true);q.enqueue('a',{n:1},'chat');const seq=q.captureBoundary('a');q.setBoundary('a','compact',seq);q.enqueue('a',{n:2},'agent');q.state('a').events.forEach(e=>e.readyAt=0);q.setHeld('a','test',false);await q.idleActive('a');assert.deepEqual(seen,[[{n:1}]]);assert.equal(q.pending('a'),1);q.close();
});

test('durable queue item identities differ after queue restart',()=>{const ids=[];for(let i=0;i<2;i++){const q=new AgentQueue({dispatch:()=>{}});q.setHeld('a','test',true);q.enqueueCommitted('a',{},'chat',null,x=>ids.push(x.id));q.close();}assert.notEqual(ids[0],ids[1]);});
test('expired steering does not consume requeued callback receipt',async()=>{let handled=0;const q=new AgentQueue({dispatch:()=>{},steer:async()=>{q.setHeld('a','test',true);throw Object.assign(Error(),{code:'steer_expired'});},onDispatched:()=>handled++});q.setHeld('a','test',true);q.state('a').busy=true;q.state('a').waiting=true;q.enqueue('a',{},'chat');q.state('a').events[0].readyAt=0;q.setHeld('a','test',false);await q.idleActive('a');assert.equal(q.pending('a'),1);assert.equal(handled,0);q.close();});
