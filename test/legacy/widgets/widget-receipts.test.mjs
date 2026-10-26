import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPublicationReceipts} from '../../src/widgets/receipts.mjs';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';

test('uncommitted receipts preserve a confirmed address and never overwrite newer view observations',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-receipts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const receipts=createPublicationReceipts({directory:()=>root});
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId),v=f.store.getView(one.viewId);
  receipts.write(w,v,{message:{text:'old'},renderHash:'old'});
  f.store.patchView(w,v.id,{message:{text:'new',reactions:['observed']}});
  receipts.recover(w,f.store);
  assert.equal(f.store.getView(v.id).deliveryUnknown,true);
  assert.deepEqual(f.store.getView(v.id).message,{text:'new',reactions:['observed']});
  receipts.write(w,{id:'candidate',target:{chatId:1}},{message:{message_id:77,chat:{id:1}},renderHash:'confirmed'});
  receipts.recover(w,f.store);
  assert.deepEqual(f.store.listCandidates(w.widgetId)[0].target,{chatId:1,messageId:77});
  assert.equal(f.store.listViews(w.widgetId).length,1);
  receipts.done(w,'candidate');assert.equal(receipts.list(w).length,0);
});

test('receipt for an already committed projection is consumed without making it uncertain',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-receipts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const receipts=createPublicationReceipts({directory:()=>root});
  const f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId),v=f.store.getView(one.viewId);
  receipts.write(w,v,{message:v.message,renderHash:v.renderHash});receipts.recover(w,f.store);
  assert.equal(f.store.getView(v.id).deliveryUnknown,false);assert.equal(receipts.list(w).length,0);
});
test('guest and inline publication candidates retain exact targets during receipt recovery',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-guest-receipts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const receipts=createPublicationReceipts({directory:()=>root}),f=await widgetFixture(t),one=await f.withOneView(),w=f.store.get(one.widgetId);
  receipts.write(w,{id:'pending-guest',target:{guestRequestId:'request'}});
  receipts.write(w,{id:'confirmed-inline',target:{inlineMessageId:'confirmed'}},{message:{text:'Game'}});
  assert.equal(receipts.recover(w,f.store),true);
  assert.deepEqual(f.store.listCandidates(w.widgetId).map(v=>v.target).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[{guestRequestId:'request'},{inlineMessageId:'confirmed'}]);
  assert.equal(f.store.listViews(w.widgetId).length,1);
});
