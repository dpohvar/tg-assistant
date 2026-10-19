import test from 'node:test';
import assert from 'node:assert/strict';
import {guestServiceFixture} from '../helpers/guest-service-fixture.mjs';
import {createGuestService} from '../../src/guest/service.mjs';
test('confirmed publication with failed local registration recovers without another send',async t=>{
  const f=guestServiceFixture(t),original=f.inlineStore.saveConfirmed;let fail=true;
  f.inlineStore.saveConfirmed=(...args)=>{if(fail)throw new Error('Database unavailable');return original(...args);};
  const result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Confirmed'});
  assert.equal(result.error,'storage_failed');assert.equal(result.inlineMessageId,'inline-1');assert.equal(f.receipts.list().length,1);
  fail=false;const recovered=createGuestService(f.options);await recovered.recover();
  assert.equal(f.calls.length,1);assert.equal(f.inlineStore.read(f.scope,'inline-1').text,'Confirmed');assert.equal(f.receipts.list().length,0);
});
test('unknown outcome is retained and never retried automatically on recovery',async t=>{
  const f=guestServiceFixture(t,{effect:async()=>{throw Object.assign(new Error('No confirmation'),{code:'telegram_transport_failed'});}});
  const result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Unknown'});assert.equal(result.error,'delivery_unknown');
  await createGuestService(f.options).recover();assert.equal(f.calls.length,1);assert.equal(f.store.publications(f.scope,f.req.guestRequestId)[0].status,'unknown');
});
test('pre-effect storage or receipt failure never calls Telegram',async t=>{
  for(const boundary of ['store','receipt']){
    const f=guestServiceFixture(t);
    if(boundary==='store')f.store.beginPublication=()=>{throw new Error('Database down');};else f.receipts.write=()=>{throw new Error('Disk down');};
    assert.equal((await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'No effect'})).error,'storage_failed');assert.equal(f.calls.length,0);
  }
});
test('recovery does not recreate or transfer unavailable agents and respects receipt expiry',async t=>{
  const f=guestServiceFixture(t),save=f.inlineStore.saveConfirmed;f.inlineStore.saveConfirmed=()=>{throw new Error('DB failed');};
  await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Confirmed'});f.inlineStore.saveConfirmed=save;f.setAvailable(false);
  await f.service.recover();assert.equal(f.receipts.list().length,1);assert.equal(f.calls.length,1);
  f.receipts.cleanup(f.req.expiresAt);assert.equal(f.receipts.list().length,0);
});
test('a confirmed foreign inline target cannot overwrite another owner',async t=>{
  const f=guestServiceFixture(t);f.db.saveChat('b',{id:2,type:'private'});const other=f.db.ensureAgent('b',2);f.inlineStore.claimOwner(other,'inline-1');
  const result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Mine'});assert.equal(result.error,'storage_failed');assert.equal(f.inlineStore.owner('b','inline-1').agentId,other.agentId);
});
test('post-send receipt failure still preserves database confirmation and never downgrades it on recovery',async t=>{
  const f=guestServiceFixture(t),write=f.receipts.write;let writes=0;
  f.receipts.write=receipt=>{if(++writes===2)throw new Error('Disk full after API success');return write(receipt);};
  const result=await f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Confirmed'});
  assert.equal(result.error,'storage_failed');assert.equal(f.store.publications(f.scope,f.req.guestRequestId)[0].status,'confirmed');
  assert.equal(f.inlineStore.owner('b','inline-1').agentId,f.scope.agentId);
  f.receipts.write=write;f.inlineStore.saveConfirmed(f.scope,'inline-1',{text:'A newer confirmed edit'});
  await f.service.recover();assert.equal(f.calls.length,1);assert.equal(f.inlineStore.read(f.scope,'inline-1').text,'A newer confirmed edit');assert.equal(f.receipts.list().length,0);
});
test('widget publication registration stays pending until its separate binding is completed',async t=>{
  const f=guestServiceFixture(t),prepared=f.service.prepare(f.scope,{text:'Widget'},'widget');
  const p=await f.service.publishPrepared(f.scope,{guestRequestId:f.req.guestRequestId,prepared,viewId:'v'});
  let settled=false;const wait=f.service.waitRegistrations('b',p.inlineMessageId).then(()=>settled=true);
  await new Promise(r=>setImmediate(r));assert.equal(settled,false);
  f.service.complete(p.publicationId);await wait;assert.equal(f.service.hasPending('b'),false);
});
test('an unrelated existing inline action is not stalled by a guest publication',async t=>{
  let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  const f=guestServiceFixture(t,{effect:async()=>{enter();await gate;return {inline_message_id:'pending'};}});
  const sending=f.service.send(f.scope,{guestRequestId:f.req.guestRequestId,text:'Pending',buttons:[{text:'New',action:'New action'}]});await entered;
  let settled=false;const waiting=f.service.waitRegistrations('b','old-inline','i:old-button').then(()=>settled=true);
  try{await new Promise(r=>setImmediate(r));assert.equal(settled,true);}finally{release();await sending;await waiting;}
});
