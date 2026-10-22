import {test} from 'node:test';import assert from 'node:assert/strict';import {createContextTracker} from '../../src/codex/context.mjs';
test('context tracks last root request only, ignores children, and invalidates usage after compact',()=>{
 const t=createContextTracker({now:()=>1000});t.bind('a',{threadId:'root',sessionEpoch:1,model:'m'});
 assert.deepEqual(t.snapshot('a'),{usedTokens:null,maxTokens:null,measuredAt:null});
 const n={threadId:'root',tokenUsage:{last:{totalTokens:120},total:{totalTokens:9999},modelContextWindow:1000}};
 t.observe('a',n);assert.deepEqual(t.snapshot('a'),{usedTokens:120,maxTokens:1000,measuredAt:'1970-01-01T00:00:01.000Z'});
 t.observe('a',{...n,threadId:'child',tokenUsage:{last:{totalTokens:800}}});assert.equal(t.snapshot('a').usedTokens,120);
 t.invalidate('a','compact');assert.equal(t.snapshot('a').usedTokens,null);assert.equal(t.snapshot('a').maxTokens,1000);
});
