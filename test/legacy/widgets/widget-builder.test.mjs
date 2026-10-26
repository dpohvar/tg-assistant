import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWidgetBuilder} from '../../src/widgets/builder.mjs';
test('temporary builds serialize per owner, release their process, and recover after failure',async()=>{
  const owner={botId:'b',agentId:'a'},calls=[];let release,first=true;
  const gate=new Promise(r=>release=r),builder=createWidgetBuilder({authorize:()=>{},host:{
    async request(_o,_method,args){calls.push(args.handler);if(first){first=false;await gate;throw new Error('compiler failed');}return {code:'snapshot'};},
    async release(){calls.push('release');},async close(){calls.push('close');}
  }});
  const a=builder.compile(owner,'first').catch(e=>e.message),b=builder.compile(owner,'second');
  await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['first']);release();
  assert.equal(await a,'compiler failed');assert.deepEqual(await b,{code:'snapshot'});
  assert.deepEqual(calls,['first','release','second','release']);await builder.close();
});
test('widget execution entry does not import or expose the compiler',()=>{
  const runtime=fs.readFileSync(new URL('../../src/widgets/runtime.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/compileWidget|esbuild|method === "build"/);
});
test('owner cancellation fences running and queued builds without poisoning a later build',async()=>{
  let release;const gate=new Promise(r=>release=r),calls=[];
  const host={async request(_o,_m,args){calls.push(args.handler);if(args.handler==='first')await gate;return args.handler;},async release(){},async close(){}};
  const builder=createWidgetBuilder({host,authorize:()=>{}}),owner={botId:'b',agentId:'a'};
  const a=builder.compile(owner,'first'),b=builder.compile(owner,'queued');a.catch(()=>{});b.catch(()=>{});
  await new Promise(r=>setImmediate(r));await builder.cancel(owner);release();
  await assert.rejects(a,{code:'widget_stopped'});await assert.rejects(b,{code:'widget_stopped'});
  assert.equal(await builder.compile(owner,'new'),'new');assert.deepEqual(calls,['first','new']);await builder.close();
});
