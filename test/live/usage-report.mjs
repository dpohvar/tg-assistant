// Offline assertions over a sanitized usage-counters live report; not production accounting.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(report.passed,true);
const counters=report.events.filter(e=>e.usage),root=report.rootThread;
if(process.argv[3]==='fork'){
 const child=counters.filter(e=>e.threadId!==root);assert.equal(new Set(child.map(e=>e.threadId)).size,1);assert.deepEqual(child[0].usage.total,child[0].usage.last);
 assert(child[0].usage.total.totalTokens<counters.filter(e=>e.threadId===root&&e.phase==='fork-child')[0].usage.total.totalTokens);
 console.log(JSON.stringify({passed:true,forkRequested:true,childInitialEqualsLast:true,childInitialTokens:child[0].usage.total.totalTokens}));process.exit(0);
}
assert.equal(new Set(counters.filter(e=>e.threadId!==root).map(e=>e.threadId)).size,1);
const first=counters.find(e=>e.phase==='ordinary-1');assert.deepEqual(first.usage.total,first.usage.last);
const childEnd=counters.filter(e=>e.phase==='child'&&e.threadId===root).at(-1);
assert.deepEqual(counters.find(e=>e.phase==='after-resume').usage.total,childEnd.usage.total);
const preCompact=counters.filter(e=>e.phase==='after-resume').at(-1).usage.total;
const compact=counters.find(e=>e.phase==='compact');assert.deepEqual(compact.usage.total,preCompact);
assert(compact.usage.last.totalTokens>0);assert.equal(compact.usage.last.inputTokens,0);
const latest=new Map(),sum={};
// Old/repeated notifications are ignored. Actual decreases require explicit handling in product code.
function account(e){const previous=latest.get(e.threadId)??{};if(e.usage.total.totalTokens<(previous.totalTokens??0))return;for(const[k,v]of Object.entries(e.usage.total)){assert(v>=(previous[k]??0));sum[k]=(sum[k]??0)+v-(previous[k]??0);}latest.set(e.threadId,e.usage.total);}
for(const e of counters)account(e);const once={...sum};for(const e of counters)account(e);assert.deepEqual(sum,once);
// Sum of distinct requests in this controlled probe matches each thread's total:
// the root does not include the child usage, so adding child totals once is necessary.
for(const[id,total]of latest){const unique=new Map();for(const e of counters.filter(e=>e.threadId===id&&e.phase!=='compact'))unique.set(`${e.turnId}:${e.usage.total.totalTokens}`,e.usage.last.totalTokens);assert.equal([...unique.values()].reduce((a,b)=>a+b,0),total.totalTokens);}
const images=new Map();for(const e of report.events.filter(e=>e.kind==='image')){const key=e.threadId+':'+e.itemId;const i=images.get(key)??{started:false,bytes:0};if(e.method==='item/started')i.started=true;if(e.method==='item/completed'&&!e.hasFailure&&e.bytes>0)i.bytes=e.bytes;images.set(key,i);}
assert.equal(images.size,1);const image=[...images.values()][0];assert(image.started);assert(image.bytes>0);
assert.equal(sum.totalTokens,sum.inputTokens+sum.outputTokens);assert(sum.cachedInputTokens<=sum.inputTokens);assert(sum.reasoningOutputTokens<=sum.outputTokens);
console.log(JSON.stringify({passed:true,threadCount:latest.size,updates:counters.length,accounted:sum,imageGenerations:images.size,imageBytes:image.bytes,resumeReplay:true,compactionTotalUnchanged:true,duplicateReplay:true,rootExcludesChild:true},null,2));
