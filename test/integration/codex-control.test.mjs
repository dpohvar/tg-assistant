import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {compactThread,reconcileControl,startTurn} from '../../src/codex/control.mjs';

class Rpc extends EventEmitter {
  calls=[];
  async request(method,args){
    this.calls.push([method,args]);
    if(method==='thread/read')return {thread:{id:'root',turns:this.turns??[]}};
    this.emit('notification',{method:'turn/started',params:{threadId:'root',turn:{id:'compact'}}});
    this.emit('notification',{method:'item/completed',params:{threadId:'foreign',turnId:'other',item:{id:'x',type:'contextCompaction'}}});
    this.emit('notification',{method:'item/completed',params:{threadId:'root',turnId:'compact',item:{id:'summary',type:'contextCompaction'}}});
    this.emit('notification',{method:'turn/completed',params:{threadId:'root',turn:{id:'compact',status:this.status??'completed'}}});
    return {};
  }
}
test('compact correlates successful terminal evidence before ACK and sends only threadId',async()=>{
  const rpc=new Rpc(),progress=[];
  const result=await compactThread(rpc,'root',{onProgress:identity=>progress.push(identity),timeout:100});
  assert.equal(result.state,'completed');assert.equal(result.identity.turnId,'compact');assert.equal(result.identity.itemId,'summary');
  assert.deepEqual(rpc.calls,[['thread/compact/start',{threadId:'root'}]]);assert.ok(progress.length);assert.equal(rpc.listenerCount('notification'),0);
});
test('interrupted compact cannot be reported successful',async()=>{
  const rpc=new Rpc();rpc.status='interrupted';assert.equal((await compactThread(rpc,'root',{timeout:100})).state,'interrupted');
});
test('reconciliation requires exact enclosing completed turn and item',async()=>{
  const rpc=new Rpc(),record={threadId:'root',turnId:'compact',itemId:'summary'};
  rpc.turns=[{id:'other',status:'completed',items:[{id:'summary',type:'contextCompaction'}]}];
  assert.equal((await reconcileControl(rpc,record)).state,'unknown');
  rpc.turns=[{id:'compact',status:'completed',items:[{id:'summary',type:'contextCompaction'}]}];
  assert.equal((await reconcileControl(rpc,record)).state,'completed');
});
test('ACK without terminal evidence is unknown and releases listeners',async()=>{
  const rpc=new Rpc();rpc.request=async()=>({});
  assert.equal((await compactThread(rpc,'root',{timeout:10})).state,'unknown');assert.equal(rpc.listenerCount('notification'),0);
});
test('root start correlates exact ACK identity even when stale and current terminal events precede it',async()=>{
 const rpc=new EventEmitter();rpc.request=async()=>{rpc.emit('notification',{method:'turn/completed',params:{threadId:'root',turn:{id:'old',status:'failed'}}});rpc.emit('notification',{method:'turn/completed',params:{threadId:'root',turn:{id:'new',status:'completed'}}});return {turn:{id:'new'}};};const identities=[];const result=await startTurn(rpc,{threadId:'root'},{onIdentity:id=>identities.push(id),timeout:100});assert.equal(result.params.turn.id,'new');assert.deepEqual(identities,['new']);assert.equal(rpc.listenerCount('notification'),0);
});
