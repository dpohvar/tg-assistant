import test from 'node:test';
import assert from 'node:assert/strict';
import {inlineFixture,tick} from '../helpers/inline-fixture.mjs';
import {normalizeInlineResults} from '../../src/inline/results.mjs';

const normalizer=(scope,items)=>normalizeInlineResults(scope,items,{allowUnprovenFileIds:true});
const photo=id=>({native:{type:'photo',id,photo_file_id:'file-'+id}});
async function start(t,options={}) {
  const f=inlineFixture(t,{normalizeResults:normalizer,...options}),first=await f.query();await f.clock.advance(2000);
  const sent=await f.query({offset:first.next_offset});
  return {...f,requestId:f.queued[0].event.requestId,cursor:sent.next_offset};
}

test('streamed photos wake waiters and keep accepting portions until explicit completion',async t=>{
  const f=await start(t);await f.query({offset:f.cursor,id:'waiting'});await f.clock.advance(800);
  assert.deepEqual(f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('one')],done:false}),{status:'accepted'});await tick();
  const first=f.answers.at(-1);assert.equal(first.results[0].photo_file_id,'file-one');assert.ok(first.next_offset);assert.equal(f.clock.now(),2800);
  await f.query({offset:first.next_offset,id:'next'});await f.clock.advance(5000);
  const working=f.answers.at(-1);assert.equal(working.results[0].title,'⬇️ Agent is working');
  f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('two')],done:false});
  const second=await f.query({offset:working.next_offset});assert.equal(second.results[0].photo_file_id,'file-two');assert.ok(second.next_offset);
  f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('three')],done:true});
  const third=await f.query({offset:second.next_offset});assert.equal(third.results[0].photo_file_id,'file-three');assert.equal(third.next_offset,'');
  assert.deepEqual(f.service.setResults(f.scope,{requestId:f.requestId,results:[{bad:true}]}),{status:'already_set'});
});

test('status arrows reflect remaining items at delivery and never alter authored message content',async t=>{
  const f=await start(t,{policy:{pageSize:1}});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Preparing',description:'Three images'}],done:false});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Publishable',message:{text:'Original'}}],done:false});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Finished'}],done:true});
  const first=await f.query({offset:f.cursor});assert.equal(first.results[0].title,'⬇️ Preparing');assert.equal(first.results[0].description,'Three images');assert.equal(first.results[0].input_message_content.message_text,'✖️');
  const second=await f.query({offset:first.next_offset});assert.equal(second.results[0].title,'Publishable');assert.equal(second.results[0].input_message_content.message_text,'Original');
  const last=await f.query({offset:second.next_offset});assert.equal(last.results[0].title,'Finished');assert.equal(last.next_offset,'');
  assert.equal(first.results[0].title,'⬇️ Preparing','previously sent titles remain unchanged');
});

test('buffered nonfinal status loses its continuation arrow when completed before delivery',async t=>{
  const f=await start(t);
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Ready'}],done:false});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[],done:true});
  const page=await f.query({offset:f.cursor});assert.equal(page.results[0].title,'Ready');assert.equal(page.next_offset,'');
});

test('empty completion after all earlier items were delivered wakes and closes without a placeholder',async t=>{
  const f=await start(t);f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('one')],done:false});
  const photoPage=await f.query({offset:f.cursor});await f.query({offset:photoPage.next_offset,id:'finishing'});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[],done:true});await tick();
  const end=f.answers.at(-1);assert.equal(end.inline_query_id,'finishing');assert.deepEqual(end.results,[]);assert.equal(end.next_offset,'');
  assert.equal(f.registered.length,1);
});

test('empty nonfinal portions keep waiting and a truly empty completion yields Work complete',async t=>{
  const f=await start(t);await f.query({offset:f.cursor,id:'waiting'});const count=f.answers.length;
  f.service.setResults(f.scope,{requestId:f.requestId,results:[],done:false});await tick();assert.equal(f.answers.length,count);
  f.service.setResults(f.scope,{requestId:f.requestId,results:[],done:true});await tick();
  assert.equal(f.answers.at(-1).results[0].title,'Work complete');assert.equal(f.answers.at(-1).next_offset,'');
});

test('invalid final portion is atomic and does not close or overwrite previous portions',async t=>{
  const f=await start(t);f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('one')],done:false});
  assert.throws(()=>f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('two'),{title:'Bad',message:{text:3}}],done:true}),{code:'invalid_argument'});
  assert.throws(()=>f.service.setResults(f.scope,{requestId:f.requestId,results:[],done:'true'}),{code:'invalid_argument'});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('three')],done:true});
  const page=await f.query({offset:f.cursor});assert.deepEqual(page.results.map(r=>r.photo_file_id),['file-one','file-three']);assert.equal(page.next_offset,'');
});

test('portion order survives photo sorting and photo-to-text transitions get separate pages',async t=>{
  const f=await start(t);
  f.service.setResults(f.scope,{requestId:f.requestId,results:[photo('one'),{title:'First report'}],done:false});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Second report'},photo('two')],done:true});
  let cursor=f.cursor;const pages=[];
  while(cursor){const page=await f.query({offset:cursor});pages.push(page);cursor=page.next_offset;}
  assert.deepEqual(pages.map(p=>p.results.map(r=>r.type)),[['article'],['photo'],['article'],['photo']]);
  assert.equal(pages[0].results[0].title,'⬇️ First report');assert.equal(pages[1].results[0].photo_file_id,'file-one');assert.equal(pages[2].results[0].title,'⬇️ Second report');assert.equal(pages[3].results[0].photo_file_id,'file-two');
});

test('repeating a portion is allowed but repeated authored IDs receive distinct wire IDs',async t=>{
  const f=await start(t);const items=[photo('same')];
  f.service.setResults(f.scope,{requestId:f.requestId,results:items,done:false});
  f.service.setResults(f.scope,{requestId:f.requestId,results:items,done:true});
  const page=await f.query({offset:f.cursor});assert.equal(page.results.length,2);assert.notEqual(page.results[0].id,page.results[1].id);assert.equal(items[0].native.id,'same');
});

test('native articles are not statuses even when the stream remains open',async t=>{
  const f=await start(t);f.service.setResults(f.scope,{requestId:f.requestId,results:[{native:{type:'article',id:'raw',title:'Native',input_message_content:{message_text:'Native content'}}}],done:false});
  const page=await f.query({offset:f.cursor});assert.equal(page.results[0].title,'Native');assert.equal(page.results[0].input_message_content.message_text,'Native content');assert.ok(page.next_offset);
});

test('concurrent repeats of a cursor share the exact page and button registration',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);let entered=0;
  const f=await start(t,{policy:{pageSize:1},registerPage:async()=>{if(++entered===1)await gate;}});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'One',message:{text:'One',buttons:[{text:'Start',action:'Start game'}]}},{title:'Two',message:{text:'Two'}}],done:true});
  await f.query({offset:f.cursor,id:'a'});await f.query({offset:f.cursor,id:'b'});assert.equal(f.registered.length,1);
  release();await tick();const a=f.answers.find(x=>x.inline_query_id==='a'),b=f.answers.find(x=>x.inline_query_id==='b');
  assert.ok(a);assert.ok(b);assert.deepEqual(a.results,b.results);assert.equal(a.next_offset,b.next_offset);assert.equal(f.registered.length,1);
  const next=await f.query({offset:a.next_offset});assert.equal(next.results[0].title,'Two');assert.equal(next.next_offset,'');
  const replay=await f.query({offset:f.cursor});assert.deepEqual(replay.results,a.results);assert.equal(replay.next_offset,a.next_offset);assert.equal(f.registered.length,2);
});

test('appending during asynchronous registration keeps the new portion available',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=await start(t,{registerPage:()=>gate});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'One'}],done:false});await f.query({offset:f.cursor,id:'a'});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Two'}],done:true});release();await tick();
  const a=f.answers.find(x=>x.inline_query_id==='a');assert.equal(a.results[0].title,'⬇️ One');assert.ok(a.next_offset);
  const b=await f.query({offset:a.next_offset});assert.equal(b.results[0].title,'Two');assert.equal(b.next_offset,'');
});

test('completion during asynchronous registration removes the last status arrow',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=await start(t,{registerPage:()=>gate});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Done'}],done:false});await f.query({offset:f.cursor,id:'a'});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[],done:true});release();await tick();
  const page=f.answers.find(x=>x.inline_query_id==='a');assert.equal(page.results[0].title,'Done');assert.equal(page.next_offset,'');
});

test('distinct simultaneous cursors allocate successive pages serially',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);let entered=0;
  const f=await start(t,{policy:{pageSize:1},registerPage:()=>++entered===1?gate:undefined});
  f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'One',message:{text:'1'}},{title:'Two',message:{text:'2'}}]});
  const other=f.requests.issueCursor(f.requestId);
  await f.query({offset:f.cursor,id:'a'});await f.query({offset:other,id:'b'});assert.equal(f.registered.length,1);
  release();await tick();
  assert.equal(f.answers.find(x=>x.inline_query_id==='a').results[0].title,'One');assert.equal(f.answers.find(x=>x.inline_query_id==='b').results[0].title,'Two');
  assert.equal(f.registered.length,2);
});

test('replacement during registration discards unsent portions and makes cursor replays unavailable',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=await start(t,{registerPage:()=>gate});f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Old'}],done:false});
  await f.query({offset:f.cursor,id:'old'});const fresh=await f.query({query:'new'});release();await tick();
  assert.deepEqual(f.answers.find(x=>x.inline_query_id==='old').results,[]);
  assert.throws(()=>f.service.setResults(f.scope,{requestId:f.requestId,results:[{title:'Late'}],done:true}),{code:'request_unavailable'});
  const replay=await f.query({offset:f.cursor});assert.deepEqual(replay.results,[]);assert.ok(fresh.next_offset);assert.equal(f.requests.current('b',1).query,'new');
});
