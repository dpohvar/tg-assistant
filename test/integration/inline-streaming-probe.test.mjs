import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runStreamingProbe,streamInlinePortions,streamingProbeUpdate} from '../manual/inline-streaming.mjs';
import {inlineFixture,tick} from '../helpers/inline-fixture.mjs';
import {normalizeInlineResults} from '../../src/inline/results.mjs';

test('streaming live probe requires explicit configuration without starting network operations',async()=>{
  await assert.rejects(runStreamingProbe({argv:[]}),/Explicit private test config/);
});

test('an empty native backlog restores valid polling offsets and cleans only the three owner buffers',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'inline-stream-probe-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'test.json'),state=path.join(root,'run');
  fs.writeFileSync(config,JSON.stringify({controllerActive:false,username:'dpohvar_test_pub_bot',ownerId:1,botTelegramId:42,token:'fixture-placeholder'}));
  const abort=new AbortController(),calls=[];let messageId=10;
  await runStreamingProbe({argv:['--config',config,'--state-dir',state,'--duration-seconds','30'],signal:abort.signal,log:event=>{if(event.type==='ready')abort.abort();},telegramFactory:()=>({call:async(bot,method,args)=>{
    calls.push({method,args});
    if(method==='getMe')return {id:42,username:'dpohvar_test_pub_bot',supports_inline_queries:true};
    if(method==='getWebhookInfo')return {url:'',allowed_updates:['message','callback_query']};
    if(method==='getChat')return {id:1,type:'private'};
    if(method==='getUpdates')return [];
    if(method==='sendPhoto'){const id=++messageId;return {message_id:id,date:1,chat:{id:1,type:'private'},photo:[{file_id:'file'+id,file_unique_id:'unique'+id}]};}
    if(method==='deleteMessage')return true;
    throw new Error('Unexpected method '+method);
  }})});
  const polls=calls.filter(x=>x.method==='getUpdates');assert.equal(polls.length,2);assert.equal(polls[1].args.offset,undefined);assert.deepEqual(polls[1].args.allowed_updates,['message','callback_query']);
  assert.deepEqual(calls.filter(x=>x.method==='deleteMessage').map(x=>x.args),[{chat_id:1,message_id:11},{chat_id:1,message_id:12},{chat_id:1,message_id:13}]);
  assert.ok(calls.filter(x=>x.method==='sendPhoto').every(x=>x.args.disable_notification===true));
  assert.equal(fs.existsSync(path.join(root,'inline-calibration.lock')),false);
  const cleanup=JSON.parse(fs.readFileSync(path.join(state,'cleanup.json'),'utf8'));assert.equal(cleanup.updatesRestored,true);assert.equal(cleanup.cleanup.length,3);
});

test('streaming probe accepts only owner inline requests and its exact private stop command',()=>{
  assert.equal(streamingProbeUpdate({inline_query:{from:{id:1}}},1),true);
  assert.equal(streamingProbeUpdate({message:{from:{id:1},chat:{id:1},text:'/stream stop'}},1),true);
  for(const update of [{inline_query:{from:{id:2}}},{message:{from:{id:1},chat:{id:-3},text:'/stream stop'}},{message:{from:{id:2},chat:{id:1},text:'/stream stop'}},{message:{from:{id:1},chat:{id:1},text:'hello'}},{callback_query:{from:{id:1}}}])assert.equal(streamingProbeUpdate(update,1),false);
});

test('deterministic live sequence exercises real streaming pages and delayed empty completion',async t=>{
  const f=inlineFixture(t,{normalizeResults:(scope,items)=>normalizeInlineResults(scope,items,{allowUnprovenFileIds:true})});
  const first=await f.query();await f.clock.advance(2000);const sent=await f.query({offset:first.next_offset});
  const requestId=f.queued[0].event.requestId,photos=['one','two','three'].map(id=>({native:{type:'photo',id,photo_file_id:id}}));
  let resume;const work=streamInlinePortions({invoke:async(name,args)=>f.service.setResults(f.scope,args),requestId,photos,mode:'late-close',pause:()=>new Promise(resolve=>resume=resolve)});await tick();
  const status=await f.query({offset:sent.next_offset});assert.match(status.results[0].title,/^⬇️ Preparing/);let cursor=status.next_offset;
  for(const id of ['one','two','three']){
    await f.query({offset:cursor,id:'wait-'+id});await f.clock.advance(5000);const wait=f.answers.at(-1);assert.equal(wait.results[0].title,'⬇️ Agent is working');
    resume();await tick();const page=await f.query({offset:wait.next_offset});assert.equal(page.results[0].photo_file_id,id);assert.ok(page.next_offset);cursor=page.next_offset;
  }
  await f.query({offset:cursor,id:'end'});resume();await work;await tick();
  const end=f.answers.at(-1);assert.equal(end.inline_query_id,'end');assert.deepEqual(end.results,[]);assert.equal(end.next_offset,'');
});
