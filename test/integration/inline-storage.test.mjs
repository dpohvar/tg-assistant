import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';

function fixture(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});
  const a=db.ensureAgent('b',1),owner={botId:'b',agentId:a.agentId,chatId:1};let now=1000;
  const store=createInlineStore(db,{now:()=>now}),page=[{native:{type:'article',id:'result'},definitions:[{btnId:'one',tipId:'tip',key:'go',group:'start',callbackKey:'[start]go',permits:null,action:'Start Wordle'}]}];
  const callback=(id='cb',user=1)=>({id,inline_message_id:'inline-one',from:{id:user,first_name:'Fixture'},data:'i:one'});
  return {db,store,owner,page,callback,advance:n=>now+=n};
}
test('registration is idempotent and cannot resurrect a consumed group',t=>{
  const f=fixture(t);f.store.registerPage(f.owner,f.page);const first=f.store.button('b','one');f.advance(10);f.store.registerPage(f.owner,f.page);assert.equal(f.store.button('b','one').expiresAt,first.expiresAt);
  const accepted=f.store.acceptButton({botId:'b',callback:f.callback(),owner:f.owner});assert.equal(accepted.status,'accepted');
  f.store.registerPage(f.owner,f.page);assert.equal(f.store.button('b','one'),null);assert.equal(f.store.pendingEvents().length,1);
  assert.equal(f.store.acceptButton({botId:'b',callback:f.callback(),owner:f.owner}).status,'duplicate');
  assert.equal(f.store.acceptButton({botId:'b',callback:f.callback('another',2),owner:f.owner}).status,'ignored');
});
test('permit and expiry checks apply before cleanup and accepted events carry the actual clicker',t=>{
  const f=fixture(t);f.page[0].definitions[0].permits={'[start]go':[2]};f.store.registerPage(f.owner,f.page);
  assert.equal(f.store.acceptButton({botId:'b',callback:f.callback(),owner:f.owner}).status,'ignored');
  const result=f.store.acceptButton({botId:'b',callback:f.callback('allowed',2),owner:f.owner});assert.equal(result.event.from.userId,2);assert.equal(result.event.inlineMessageId,'inline-one');assert.equal(result.event.action,'Start Wordle');
  assert.equal('chatId'in result.event,false);assert.equal('messageId'in result.event,false);
  f.store.markQueued(result.eventId);assert.equal(f.store.pendingEvents().length,0);
  const repeat={...f.page[0],definitions:[{...f.page[0].definitions[0],btnId:'repeat',group:null,callbackKey:'go'}]};f.store.registerPage(f.owner,[repeat]);f.advance(30*86400000+1);assert.equal(f.store.button('b','repeat'),null);
});
test('database failure rolls back ownership, event and one-shot consumption together',t=>{
  const f=fixture(t);f.store.registerPage(f.owner,f.page);f.db.sql.exec("CREATE TRIGGER fail_inline_event BEFORE INSERT ON inline_button_events BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END");
  assert.throws(()=>f.store.acceptButton({botId:'b',callback:f.callback(),owner:f.owner}));assert.ok(f.store.button('b','one'));assert.equal(f.store.pendingEvents().length,0);assert.equal(f.store.owner('b','inline-one'),null);
});
test('confirmed partial snapshots retain ownership and unknown edits do not extend retention',t=>{
  const f=fixture(t);f.store.claimOwner(f.owner,'inline-one');f.store.saveConfirmed(f.owner,'inline-one',{text:'known'});const first=f.store.read(f.owner,'inline-one');
  assert.equal(first.text,'known');assert.equal(first.snapshotComplete,false);
  f.advance(10);f.store.markUnknown(f.owner,'inline-one');const unknown=f.store.read(f.owner,'inline-one');assert.equal(unknown.deliveryUnknown,true);assert.equal(unknown.updatedAt,first.updatedAt);
  assert.throws(()=>f.store.claimOwner({...f.owner,agentId:'foreign'},'inline-one'),e=>e.code==='inline_owner_conflict'&&e.ownerAgentId===f.owner.agentId);
  f.store.saveConfirmed(f.owner,'inline-one',{reply_markup:{inline_keyboard:[]}});assert.equal(f.store.read(f.owner,'inline-one').text,'known');assert.equal(f.store.read(f.owner,'inline-one').deliveryUnknown,false);
  f.advance(30*86400000+1);f.store.cleanup();assert.equal(f.store.read(f.owner,'inline-one'),null);assert.equal(f.store.owner('b','inline-one'),null);
});

test('confirmed content conversion discards obsolete media and formatting components',t=>{
  const f=fixture(t);f.store.claimOwner(f.owner,'inline-one');
  f.store.saveConfirmed(f.owner,'inline-one',{photo:'old-photo',caption:'old caption',reply_markup:{inline_keyboard:[]}});
  f.store.saveConfirmed(f.owner,'inline-one',{rich_message:{blocks:[{type:'paragraph',text:'new'}]}});
  let saved=f.store.read(f.owner,'inline-one');assert.equal(saved.photo,undefined);assert.equal(saved.caption,undefined);
  f.store.saveConfirmed(f.owner,'inline-one',{text:'plain',entities:[{type:'bold',offset:0,length:5}]});
  f.store.saveConfirmed(f.owner,'inline-one',{text:'new plain'});
  assert.equal(f.store.read(f.owner,'inline-one').entities,undefined);
  f.store.saveConfirmed(f.owner,'inline-one',{photo:'new-photo'});
  saved=f.store.read(f.owner,'inline-one');assert.equal(saved.text,undefined);assert.equal(saved.entities,undefined);assert.equal(saved.rich_message,undefined);assert.equal(saved.photo,'new-photo');
  f.store.saveConfirmed(f.owner,'inline-one',{photo:'captioned-photo',caption:'old caption',caption_entities:[{type:'italic',offset:0,length:3}]});
  f.store.saveConfirmed(f.owner,'inline-one',{photo:'replacement-photo'});
  saved=f.store.read(f.owner,'inline-one');assert.equal(saved.caption,undefined);assert.equal(saved.caption_entities,undefined);
});
