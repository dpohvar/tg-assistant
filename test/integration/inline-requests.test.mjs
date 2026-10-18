import test from 'node:test';
import assert from 'node:assert/strict';
import {createInlineRequests} from '../../src/inline/requests.mjs';

function fixture() {
  let time=0;
  const requests=createInlineRequests({now:()=>time});
  return {requests,at:n=>{time=n;},begin:extra=>requests.begin({botId:'b',userId:1,agentId:'a',query:'wordle',...extra})};
}
test('a new initial request replaces even identical query text',()=>{
  const f=fixture(),old=f.begin(),cursor=f.requests.issueCursor(old.requestId),next=f.begin();
  assert.notEqual(next.requestId,old.requestId);
  assert.equal(f.requests.resolveCursor({botId:'b',userId:1,cursor}),null);
  assert.throws(()=>f.requests.setReady({botId:'b',agentId:'a'},old.requestId,[]),{code:'request_unavailable'});
});
test('request lifetime includes waiting and ready time and is never renewed',()=>{
  const f=fixture(),r=f.begin();
  f.at(50*60000); f.requests.setReady({botId:'b',agentId:'a'},r.requestId,[{native:{type:'article'}}]);
  assert.equal(r.expiresAt,3600000);
  const cursor=f.requests.issueCursor(r.requestId);
  f.at(3600000);
  assert.equal(f.requests.resolveCursor({botId:'b',userId:1,cursor}),null);
  assert.throws(()=>f.requests.setReady({botId:'b',agentId:'a'},r.requestId,[]),{code:'request_unavailable'});
  assert.equal(r.prepared,undefined);
  assert.equal(r.query,undefined);
});
test('cursor belongs to bot, user and exact version and records issuance time',()=>{
  const f=fixture(),r=f.begin(); f.at(123);
  const cursor=f.requests.issueCursor(r.requestId);
  assert.ok(Buffer.byteLength(cursor)<=64);
  assert.equal(f.requests.resolveCursor({botId:'b',userId:1,cursor}).issuedAt,123);
  assert.equal(f.requests.resolveCursor({botId:'other',userId:1,cursor}),null);
  assert.equal(f.requests.resolveCursor({botId:'b',userId:2,cursor}),null);
  assert.equal(f.requests.resolveCursor({botId:'b',userId:1,cursor:'made-up'}),null);
});
test('first accepted final wins, including an empty list, and owner is rechecked',()=>{
  const f=fixture(),r=f.begin();
  assert.throws(()=>f.requests.setReady({botId:'b',agentId:'foreign'},r.requestId,[]),{code:'access_denied'});
  assert.deepEqual(f.requests.setReady({botId:'b',agentId:'a'},r.requestId,[]),{status:'accepted'});
  assert.deepEqual(f.requests.setReady({botId:'b',agentId:'a'},r.requestId,[{bad:true}]),{status:'already_set'});
  assert.deepEqual(r.prepared,[]);
});
test('closing a request wakes subscribers once, clears content and does not close its successor',()=>{
  const f=fixture(),r=f.begin(); let wakes=0;
  f.requests.subscribe(r.requestId,()=>wakes++);
  const next=f.begin();
  f.requests.close(r.requestId,'late_failure');
  assert.equal(wakes,1);
  assert.equal(r.query,undefined);
  assert.equal(f.requests.current('b',1),next);
});
