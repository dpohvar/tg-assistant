import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../../src/storage/database.mjs';
import {createGuestStore} from '../../src/guest/store.mjs';
import {retention} from '../../src/storage/retention.mjs';

const DAY=86400000;
function fixture(t,{file=':memory:'}={}) {
  const db=openDatabase(file);t.after(()=>db.close());
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  db.saveChat('b',{id:1,type:'private'});db.saveChat('b',{id:2,type:'private'});
  const a=db.ensureAgent('b',1),other=db.ensureAgent('b',2);let time=1000;
  const store=createGuestStore(db,{now:()=>time});
  const message={message_id:7,date:1,chat:{id:1,type:'private'},from:{id:1,first_name:'Caller'},guest_query_id:'native-guest',text:'@bot hello',entities:[{type:'mention',offset:0,length:4}]};
  return {db,store,a,other,message,setTime:value=>{time=value;},record:(overrides={})=>store.record({botId:'b',agentId:a.agentId,callerUserId:1,updateId:11,message,...overrides})};
}

test('guest records are isolated from ordinary chat history and immutable on replay',t=>{
  const f=fixture(t),first=f.record();
  assert.equal(first.created,true);assert.ok(first.request.guestRequestId);
  assert.deepEqual(first.request.message,f.message);
  assert.equal(f.db.getMessage('b',1,7),null);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM chats').get().n,2);
  f.setTime(3000);
  const again=f.record({agentId:f.other.agentId,callerUserId:2,message:{...f.message,text:'changed'}});
  assert.equal(again.created,false);assert.equal(again.request.guestRequestId,first.request.guestRequestId);
  assert.equal(again.request.receivedAt,1000);assert.equal(again.request.agentId,f.a.agentId);
  assert.equal(again.request.message.text,'@bot hello');
});

test('foreign, missing and expired guest handles share the unavailable error',t=>{
  const f=fixture(t),id=f.record().request.guestRequestId;
  for(const [scope,key] of [[f.other,id],[{...f.a,botId:'foreign'},id],[f.a,'missing']])assert.throws(()=>f.store.get(scope,key),{code:'guest_request_unavailable'});
  f.setTime(1000+30*DAY-1);assert.equal(f.store.get(f.a,id).guestRequestId,id);
  f.setTime(1000+30*DAY);assert.throws(()=>f.store.get(f.a,id),{code:'guest_request_unavailable'});
});

test('each explicit guest publication keeps an independent outcome without consuming the request',t=>{
  const f=fixture(t),id=f.record().request.guestRequestId;
  const one=f.store.beginPublication(f.a,{guestRequestId:id,prepared:{native:{type:'article'}}});
  f.setTime(2000);
  const two=f.store.beginPublication(f.a,{guestRequestId:id,prepared:{native:{type:'article'}},viewId:'v2'});
  assert.notEqual(one.publicationId,two.publicationId);
  f.store.saveOutcome(one.publicationId,{status:'confirmed',inlineMessageId:'inline-one'});
  f.store.saveOutcome(two.publicationId,{status:'confirmed',inlineMessageId:'inline-two'});
  const results=f.store.publications(f.a,id);
  assert.equal(results.length,2);assert.deepEqual(new Set(results.map(x=>x.inlineMessageId)),new Set(['inline-one','inline-two']));
  assert.ok(results.every(x=>x.expiresAt===1000+30*DAY));
  assert.equal(f.store.get(f.a,id).guestRequestId,id);
  assert.throws(()=>f.store.beginPublication(f.other,{guestRequestId:id,prepared:{}}),{code:'guest_request_unavailable'});
  assert.throws(()=>f.store.publications(f.other,id),{code:'guest_request_unavailable'});
});

test('guest errors and uncertain attempts persist without replacing a confirmed answer',t=>{
  const f=fixture(t),id=f.record().request.guestRequestId;
  for(const outcome of [{status:'confirmed',inlineMessageId:'known'},{status:'rejected',error:'telegram_api_error',description:'native reason'},{status:'unknown',error:'delivery_unknown'}]){
    const p=f.store.beginPublication(f.a,{guestRequestId:id,prepared:{}});f.store.saveOutcome(p.publicationId,outcome);
  }
  assert.deepEqual(f.store.publications(f.a,id).map(x=>x.status),['confirmed','rejected','unknown']);
  assert.equal(f.store.publications(f.a,id)[1].outcome.description,'native reason');
});

test('guest cleanup is silent and preserves live inline widget ownership',async t=>{
  const f=fixture(t),id=f.record().request.guestRequestId;
  const pub=f.store.beginPublication(f.a,{guestRequestId:id,prepared:{}});f.store.saveOutcome(pub.publicationId,{status:'confirmed',inlineMessageId:'live'});
  f.db.sql.prepare("INSERT INTO widgets(widgetId,botId,agentId,generation,status,handler,snapshotId,description,state,createdAt) VALUES('w','b',?,1,'active','wordle.tsx','old','Wordle','{}',1000)").run(f.a.agentId);
  f.db.sql.prepare("INSERT INTO inline_message_owners VALUES('b','live',?,1000,2000)").run(f.a.agentId);
  f.db.sql.prepare("INSERT INTO widget_views(viewId,widgetId,botId,agentId,inlineMessageId,bindingEpoch) VALUES('v','w','b',?,'live','epoch')").run(f.a.agentId);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-retention-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  await retention({db:f.db,config:{botsDir:root,codexHome:root},telegram:{call:()=>assert.fail('Cleanup must not notify')},now:1000+30*DAY});
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM guest_requests').get().n,0);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM guest_publications').get().n,0);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM widget_views').get().n,1);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_message_owners').get().n,1);
});

test('schema 16 upgrade preserves Wordle registrations and guest data survives reopen',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-migration-')),file=path.join(root,'db.sqlite');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const old=new DatabaseSync(file);
  for(let n=1;n<=16;n++)old.exec(fs.readFileSync(new URL(`../../src/storage/migrations/${String(n).padStart(3,'0')}.sql`,import.meta.url),'utf8'));
  old.exec(`INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',42,'bot',1);
    INSERT INTO chats(botId,chatId,chatType,name,json) VALUES('b',1,'private','Owner','{"id":1,"type":"private"}');
    INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',1,'model',1);
    INSERT INTO widgets(widgetId,botId,agentId,generation,status,handler,snapshotId,description,state,createdAt) VALUES('wordle','b','a',1,'active','wordle.tsx','snapshot','Wordle','{"input":"А"}',1);
    INSERT INTO widget_views(viewId,widgetId,botId,agentId,chatId,messageId,bindingEpoch) VALUES('old-view','wordle','b','a',1,7,'old-epoch');`);old.close();
  let db=openDatabase(file),scope=db.agent('b',1),store=createGuestStore(db,{now:()=>1000});
  const request=store.record({botId:'b',agentId:'a',callerUserId:1,updateId:9,message:{guest_query_id:'retained',date:1,chat:{id:-5,type:'group'},text:'@bot'}}).request;
  const publication=store.beginPublication(scope,{guestRequestId:request.guestRequestId,prepared:{native:{type:'article'}}});store.saveOutcome(publication.publicationId,{status:'confirmed',inlineMessageId:'retained-inline'});db.close();
  db=openDatabase(file);try{
    store=createGuestStore(db,{now:()=>2000});assert.equal(store.get(scope,request.guestRequestId).queryId,'retained');
    assert.equal(store.publications(scope,request.guestRequestId)[0].inlineMessageId,'retained-inline');
    assert.equal(db.sql.prepare('SELECT max(version) v FROM schema_migrations').get().v,18);
    assert.equal(db.sql.prepare("SELECT state FROM widgets WHERE widgetId='wordle'").get().state,'{"input":"А"}');
    assert.equal(db.sql.prepare("SELECT messageId FROM widget_views WHERE viewId='old-view'").get().messageId,7);
    db.sql.prepare("DELETE FROM agents WHERE agentId='a'").run();assert.equal(db.sql.prepare('SELECT count(*) n FROM guest_requests').get().n,0);
  }finally{db.close();}
});
