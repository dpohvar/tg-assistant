import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {openDatabase} from '../../src/storage/database.mjs';
import {createWidgetStore} from '../../src/widgets/store.mjs';

const script=fileURLToPath(new URL('../manual/widget-callback-diagnostic.mjs',import.meta.url));
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-diagnostic-')),file=path.join(root,'controller.sqlite');
  const db=openDatabase(file);db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});
  const agent=db.ensureAgent('b',1),store=createWidgetStore(db);
  const w=store.create({botId:'b',agentId:agent.agentId,handler:'widgets/wordle/widget.tsx',snapshotId:'compiled-snapshot',description:'PRIVATE_DESCRIPTION',state:{mode:'menu',ownerId:1,players:{},secret:'PRIVATE_ANSWER'}});
  store.createView(w,{target:{inlineMessageId:'PRIVATE_INLINE_ID'},buttonNames:['menu:start','key:PRIVATE_PAYLOAD'],props:{secret:'PRIVATE_PROPS'}});
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const run=(...args)=>spawnSync(process.execPath,[script,'--db',file,...args],{encoding:'utf8',windowsHide:true,cwd:root});
  return {db,file,w,store,run};
}

test('standalone diagnostic reads widget metadata without exposing content or modifying the database',t=>{
  const f=fixture(t),before=fs.readFileSync(f.file),run=f.run('--widget',f.w.widgetId);
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout),w=report.widgets[0];
  assert.equal(w.widgetId,f.w.widgetId);assert.equal(w.snapshotId,'compiled-snapshot');assert.equal(w.sequence,0);
  assert.equal(w.state.mode,'menu');assert.equal(w.views[0].targetType,'inline');assert.equal(w.views[0].hasMenuStart,true);
  assert.equal(report.access,'readOnly');
  assert.doesNotMatch(run.stdout,/PRIVATE_|"ownerId"|"inlineMessageId"|"secret"/);
  assert.deepEqual(fs.readFileSync(f.file),before);
});

test('diagnostic reveals admitted events and state changes after the queue has already drained',t=>{
  const f=fixture(t),event={name:'menu',source:'button',receivedAt:new Date().toISOString(),delayed:false,data:{id:'PRIVATE_CALLBACK',from:{id:2}}};
  const admitted=f.store.admit(f.w,event,{durable:false});f.store.complete(f.w,admitted.seq);
  f.store.save(f.w,{state:{mode:'game',activeId:'2',players:{2:{input:'PRIVATE_INPUT'}}}});
  const run=f.run('--widget',f.w.widgetId);assert.equal(run.status,0,run.stderr);
  const w=JSON.parse(run.stdout).widgets[0];assert.equal(w.sequence,1);assert.equal(w.pending,0);assert.equal(w.state.mode,'game');assert.equal(w.state.playerCount,1);
  assert.doesNotMatch(run.stdout,/PRIVATE_|"activeId"/);
});

test('diagnostic never creates a missing database',t=>{
  const f=fixture(t),missing=f.file+'.missing',run=f.run('--widget',f.w.widgetId,'--db',missing);
  assert.notEqual(run.status,0);assert.equal(fs.existsSync(missing),false);
});

test('watch mode observes live writer commits without restarting the controller',async t=>{
  const f=fixture(t),child=spawn(process.execPath,[script,'--db',f.file,'--widget',f.w.widgetId,'--watch-seconds','1'],{windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let stdout='',stderr='',updated=false;
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.stdout.on('data',chunk=>{
    stdout+=chunk;
    if(!updated&&stdout.includes('\n')){
      updated=true;
      const admitted=f.store.admit(f.w,{name:'menu',source:'button',data:{},receivedAt:new Date().toISOString(),delayed:false},{durable:false});
      f.store.complete(f.w,admitted.seq);
    }
  });
  const code=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
  assert.equal(code,0,stderr);
  const samples=stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(samples.map(s=>s.widgets[0].sequence),[0,1]);
});
