import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

async function setup(t,handler){
  const mod=await import('../../src/files/document.mjs').catch(()=>({}));assert.equal(typeof mod.createDocumentFetcher,'function','document downloads need bounded abortable bodies');
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const fetch=(url,options)=>globalThis.fetch(`http://127.0.0.1:${server.address().port}/file`,options);
  const telegram={getToken:async()=>'fixture-token',call:async()=>({file_path:'fixture.txt'})};
  return options=>mod.createDocumentFetcher({telegram,fetch,...options});
}

test('stopping a run aborts a document body that has begun but never finishes',async t=>{
  let started;const waiting=new Promise(resolve=>started=resolve);
  const create=await setup(t,(_req,res)=>{res.writeHead(200);res.write('partial');started();});
  const abort=new AbortController(),fetchDocument=create({signal:abort.signal}),job=fetchDocument('b',{file_id:'id'},{maxBytes:100});
  await waiting;abort.abort();await assert.rejects(job,/abort/i);
});

test('document downloads enforce actual byte limits without trusting metadata',async t=>{
  const create=await setup(t,(_req,res)=>{res.writeHead(200);res.end('too much data');});
  await assert.rejects(create({})('b',{file_id:'id',file_size:1},{maxBytes:3}),/limit|large/i);
});
