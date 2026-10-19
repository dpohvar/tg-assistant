import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createEphemeralStore,EPHEMERAL_TTL} from '../../src/ephemeral/store.mjs';

const chat={id:-100,type:'supergroup'},incoming=(extra={})=>({message_id:0,ephemeral_message_id:11,date:100,chat,from:{id:1,first_name:'Alice'},receiver_user:{id:42,is_bot:true},text:'/say hello',...extra});
function fixture(t,filename=':memory:'){
  const db=openDatabase(filename);db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',chat);const a=db.ensureAgent('b',chat.id),scope={...a};let at=100000;
  const store=createEphemeralStore(db,{now:()=>at});t.after(()=>db.close());return {db,scope,store,advance:n=>at+=n};
}
test('ephemeral snapshots persist independently of ordinary history and expire at 30 days',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ephemeral-'));const filename=path.join(dir,'db.sqlite');
  const f=fixture(t,filename);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));f.store.record(f.scope,incoming(),{direction:'incoming'});
  const copy=openDatabase(filename);try{assert.equal(createEphemeralStore(copy,{now:()=>100000}).get(f.scope,{ephemeralMessageId:11}).message.text,'/say hello');}finally{copy.close();}
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM messages').get().n,0);
  f.advance(EPHEMERAL_TTL);assert.throws(()=>f.store.get(f.scope,{ephemeralMessageId:11}),{code:'ephemeral_message_unavailable'});f.store.cleanup();assert.equal(f.db.sql.prepare('SELECT count(*) n FROM ephemeral_messages').get().n,0);
});
test('ephemeral snapshots reject foreign agents, chat, bot, recipient and known reused native IDs',t=>{
  const f=fixture(t);f.store.record(f.scope,incoming(),{direction:'incoming'});
  for(const scope of [{...f.scope,agentId:'foreign'},{...f.scope,chatId:-101},{...f.scope,botId:'other'}])assert.throws(()=>f.store.get(scope,{ephemeralMessageId:11}),{code:'ephemeral_message_unavailable'});
  assert.throws(()=>f.store.get(f.scope,{ephemeralMessageId:11,receiverUserId:99}),{code:'ephemeral_message_unavailable'});
  assert.equal(f.store.record(f.scope,incoming(),{direction:'incoming'}).created,false);
  assert.throws(()=>f.store.record(f.scope,incoming({date:101,text:'different'}),{direction:'incoming'}),{code:'ephemeral_address_reused'});
  assert.throws(()=>f.store.get(f.scope,{ephemeralMessageId:11}),{code:'ephemeral_message_unavailable'});
});
test('prepared snapshots keep deletion and delivery uncertainty without becoming ordinary IDs',t=>{
  const f=fixture(t),m=incoming({ephemeral_message_id:21,from:{id:42,is_bot:true},receiver_user:{id:1},text:'Request received.'}),address={ephemeralMessageId:21,receiverUserId:1};
  f.store.record(f.scope,m,{direction:'outgoing'});f.store.update(f.scope,address,{text:'Answer'});assert.equal(f.store.get(f.scope,address).message.text,'Answer');
  f.store.markUnknown(f.scope,address);assert.equal(f.store.get(f.scope,address).deliveryUnknown,true);f.store.markDeleted(f.scope,address);assert.throws(()=>f.store.get(f.scope,address),{code:'ephemeral_message_unavailable'});
});
