import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runCalibration} from '../manual/inline-calibration.mjs';
import * as calibration from '../manual/inline-calibration.mjs';
test('calibration requires private configuration before creating a Telegram connection',async()=>{
  let connected=0;
  await assert.rejects(runCalibration({argv:[],telegramFactory:()=>{connected++;}}),/config/i);
  assert.equal(connected,0);
});
test('calibration refuses a different bot before consuming Telegram updates',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'inline-probe-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'config.json');fs.writeFileSync(config,JSON.stringify({token:'synthetic',botTelegramId:42,ownerId:1}));
  const methods=[];
  await assert.rejects(runCalibration({argv:['--config',config],telegramFactory:()=>({call:async(_b,m)=>{methods.push(m);return {id:99,supports_inline_queries:true};}})}),/identity/i);
  assert.deepEqual(methods,['getMe']);
});
test('calibration rejects invalid rows before reading credentials or starting Telegram',async()=>{
  await assert.rejects(runCalibration({argv:['--config','missing.json','--rows','51']}),/inline/i);
});

test('one-row prefetch probe keeps serving immediately after a long automatic pause and counts confirmed blocks',async()=>{
  const answers=[],events=[];let now=0;
  const probe=calibration.createPrefetchProbe({allowed:new Set([1]),now:()=>now,answer:async body=>answers.push(body),observe:e=>events.push(e)});
  await probe.receive({id:'first',from:{id:1},query:'private text',offset:''});
  for(let page=2;page<=4;page++){
    now+=5000;await probe.receive({id:'q'+page,from:{id:1},query:'private text',offset:answers.at(-1).next_offset});
  }
  assert.deepEqual(answers.map(a=>a.results.length),[1,1,1,1]);
  assert.equal(new Set(answers.flatMap(a=>a.results.map(r=>r.id))).size,4);
  assert.ok(answers.every(a=>a.next_offset&&a.cache_time===0&&a.is_personal===true));
  assert.ok(answers.every(a=>a.results[0].input_message_content.message_text==='✖️'));
  assert.equal(probe.summary().blocks,4);assert.equal(probe.summary().paginationRequests,3);
  assert.equal(probe.summary().answerFailures,0);assert.equal(JSON.stringify(events).includes('private text'),false);
  assert.equal(events.filter(e=>e.type==='prefetch_block').length,4);
});

test('prefetch retries preserve one-row identity and foreign or superseded cursors cannot extend the sample',async()=>{
  const answers=[];const probe=calibration.createPrefetchProbe({allowed:new Set([1]),answer:async body=>answers.push(body)});
  await probe.receive({id:'first',from:{id:1},query:'a',offset:''});const cursor=answers[0].next_offset;
  await probe.receive({id:'second',from:{id:1},query:'a',offset:cursor});
  await probe.receive({id:'second',from:{id:1},query:'a',offset:cursor});assert.equal(answers.length,2);
  await probe.receive({id:'retry',from:{id:1},query:'a',offset:cursor});assert.deepEqual(answers[1].results,answers[2].results);assert.equal(probe.summary().blocks,2);
  await probe.receive({id:'foreign',from:{id:2},query:'a',offset:cursor});assert.deepEqual(answers.at(-1).results,[]);
  await probe.receive({id:'new',from:{id:1},query:'b',offset:''});
  await probe.receive({id:'stale',from:{id:1},query:'a',offset:cursor});assert.deepEqual(answers.at(-1).results,[]);assert.equal(probe.summary().blocks,1);
});

test('prefetch API failures and a bounded cap are distinguished from a natural client plateau',async()=>{
  let fail=true;const answers=[];
  const probe=calibration.createPrefetchProbe({allowed:new Set([1]),maxBlocks:2,answer:async body=>{answers.push(body);if(fail)throw Object.assign(new Error('rejected'),{code:'telegram_api_error'});}});
  await probe.receive({id:'bad',from:{id:1},query:'a',offset:''});
  assert.equal(probe.summary().answerFailures,1);assert.equal(probe.summary().blocks,0);
  fail=false;await probe.receive({id:'new',from:{id:1},query:'b',offset:''});
  await probe.receive({id:'last',from:{id:1},query:'b',offset:answers.at(-1).next_offset});
  assert.equal(answers.at(-1).next_offset,'');assert.equal(probe.summary().limitReached,true);
});

test('five-row prefetch pages count unique pages separately from rows and preserve retries',async()=>{
  const answers=[],probe=calibration.createPrefetchProbe({allowed:new Set([1]),rowsPerPage:5,answer:async body=>answers.push(body)});
  await probe.receive({id:'first',from:{id:1},query:'five',offset:''});const cursor=answers[0].next_offset;
  await probe.receive({id:'next',from:{id:1},query:'five',offset:cursor});
  await probe.receive({id:'retry',from:{id:1},query:'five',offset:cursor});
  assert.deepEqual(answers.map(a=>a.results.length),[5,5,5]);assert.deepEqual(answers[1].results,answers[2].results);
  assert.equal(new Set(answers.flatMap(a=>a.results.map(r=>r.id))).size,10);
  assert.equal(probe.summary().blocks,2);assert.equal(probe.summary().rows,10);assert.equal(probe.summary().rowsPerPage,5);
  assert.equal(probe.summary().paginationRequests,2);assert.equal(probe.summary().answerFailures,0);
});

test('scaled prefetch follows 6,6,10,20,30 then repeats 30 with exact cumulative counts',async()=>{
  const answers=[],probe=calibration.createPrefetchProbe({allowed:new Set([1]),pageSizes:[6,6,10,20,30],answer:async body=>answers.push(body)});
  const counts=[];
  for(let page=1;page<=6;page++){
    await probe.receive({id:'page'+page,from:{id:1},query:'scale',offset:page===1?'':answers.at(-1).next_offset});
    counts.push(probe.summary().rows);
  }
  assert.deepEqual(answers.map(a=>a.results.length),[6,6,10,20,30,30]);
  assert.deepEqual(counts,[6,12,22,42,72,102]);
  assert.equal(new Set(answers.flatMap(a=>a.results.map(r=>r.id))).size,102);
  assert.match(answers[2].results[0].title,/\[13\]$/);assert.match(answers[5].results.at(-1).title,/\[102\]$/);
  assert.ok(answers.every(a=>a.next_offset));
  await probe.receive({id:'retry',from:{id:1},query:'scale',offset:answers[1].next_offset});
  assert.deepEqual(answers.at(-1).results,answers[2].results);assert.equal(probe.summary().rows,102);assert.equal(probe.summary().blocks,6);
});

test('invalid page scales fail before credentials or Telegram are accessed',async()=>{
  await assert.rejects(runCalibration({argv:['--config','missing.json','--case','prefetch','--page-sizes','6,0,30']}),/prefetch/i);
  await assert.rejects(runCalibration({argv:['--config','missing.json','--case','prefetch','--page-sizes','6,51']}),/prefetch/i);
});
