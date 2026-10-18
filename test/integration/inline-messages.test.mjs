import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';
import {createInlineMessages} from '../../src/inline/messages.mjs';
function fixture(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const agent=db.ensureAgent('b',1),scope={botId:'b',agentId:agent.agentId,chatId:1},store=createInlineStore(db),calls=[];
  store.claimOwner(scope,'opaque');let fail;
  const messages=createInlineMessages({db,store,access:createAccess(db),assertCurrent:()=>{},telegram:{call:async(botId,method,args)=>{calls.push({botId,method,args});if(fail)throw fail;return true;}}});
  return {db,store,scope,messages,calls,unknown:()=>fail=Object.assign(new Error('network'),{code:'telegram_transport_failed'})};
}
test('inline read is unavailable until a confirmed edit and keyboard-only snapshots are partial',async t=>{
  const f=fixture(t);assert.equal(f.messages.read(f.scope,{inlineMessageId:'opaque'}).messages[0].error,'message_not_found');
  await f.messages.edit(f.scope,{inlineMessageId:'opaque',reply_markup:{inline_keyboard:[]}});
  const item=f.messages.read(f.scope,{inlineMessageId:'opaque'}).messages[0];assert.equal(item.partial,true);assert.equal('text'in item,false);assert.equal('chatId'in item,false);
  assert.equal(f.calls[0].method,'editMessageReplyMarkup');assert.deepEqual(f.calls[0].args,{inline_message_id:'opaque',reply_markup:{inline_keyboard:[]}});
});
test('confirmed text/rich content keeps formatting and failed edits retain the last confirmed snapshot',async t=>{
  const f=fixture(t);await f.messages.edit(f.scope,{inlineMessageId:'opaque',text:'known',entities:[{type:'bold',offset:0,length:5}],reply_markup:{inline_keyboard:[]}});
  let item=f.messages.read(f.scope,{inlineMessageId:'opaque'}).messages[0];assert.equal(item.partial,false);assert.equal(item.entities[0].type,'bold');
  f.unknown();const result=await f.messages.edit(f.scope,{inlineMessageId:'opaque',text:'unknown'});assert.equal(result.error,'delivery_unknown');
  item=f.messages.read(f.scope,{inlineMessageId:'opaque'}).messages[0];assert.equal(item.text,'known');assert.equal(item.deliveryUnknown,true);assert.equal(item.partial,false);
});
test('inline addressing and ownership checks happen before publication or action registration',async t=>{
  const f=fixture(t);await assert.rejects(f.messages.edit(f.scope,{inlineMessageId:'opaque',messageId:7,text:'ambiguous'}),{code:'invalid_argument'});
  await assert.rejects(f.messages.edit({...f.scope,agentId:'foreign'},{inlineMessageId:'opaque',text:'takeover'}),{code:'inline_owner_conflict'});
  assert.equal(f.calls.length,0);
});
