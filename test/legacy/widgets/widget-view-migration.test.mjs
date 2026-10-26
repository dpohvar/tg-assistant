import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../../src/storage/database.mjs';
import {createWidgetStore} from '../../src/widgets/store.mjs';

function legacy(t,{status='active',messageId=7}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'widget-view-migration-')),file=path.join(root,'db.sqlite');
  const sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys=ON');
  for(let i=1;i<=14;i++)sql.exec(fs.readFileSync(new URL(`../../src/storage/migrations/${String(i).padStart(3,'0')}.sql`,import.meta.url),'utf8'));
  sql.exec(`INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',42,'bot',1);
    INSERT INTO chats(botId,chatId,chatType,name,json,agentEnabled) VALUES('b',1,'private','Owner','{}',1);
    INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES('a','b',1,'model',1);
    INSERT INTO vault VALUES('b','KEEP','synthetic');`);
  sql.prepare(`INSERT INTO widgets(widgetId,botId,agentId,status,chatId,messageId,handler,snapshotId,description,state,message,createdAt,disabledReason,renderHash,renderSpec,buttonNames,sequence)
    VALUES('legacyw','b','a',?,1,?,'wordle.tsx','snapshot','Wordle','{"players":{"one":1}}',?,1,?,'oldhash','{"text":"keep"}','["key:A"]',1)`)
    .run(status,messageId,messageId?JSON.stringify({message_id:messageId,chat:{id:1,type:'private'},text:'keep'}):null,status==='disabled'?'old failure':null);
  const event={name:'key',source:'button',receivedAt:'2026-10-18T00:00:00.000Z',delayed:false,data:{id:'cb',data:'key:A',from:{id:1}}};
  sql.prepare('INSERT INTO widget_events(widgetId,seq,payload,bytes) VALUES(?,?,?,?)').run('legacyw',1,JSON.stringify(event),Buffer.byteLength(JSON.stringify(event)));
  sql.close();return file;
}
test('legacy publication becomes a stable view without changing widget, source or active queue',t=>{
  const file=legacy(t);let db=openDatabase(file),s=createWidgetStore(db);
  t.after(()=>{db.close();fs.rmSync(path.dirname(file),{recursive:true,force:true});});
  const w=s.get('legacyw'),v=s.listViews('legacyw')[0];
  assert.equal(w.widgetId,'legacyw');assert.equal(w.agentId,'a');assert.deepEqual(w.state,{players:{one:1}});
  assert.deepEqual(v.target,{chatId:1,messageId:7});assert.deepEqual(v.props,{});assert.equal(v.renderHash,'oldhash');
  assert.deepEqual(v.buttonNames,['key:A']);assert.equal(w.pending,1);
  const head=s.head(w);assert.equal(head.event.data.data,'key:A');assert.equal(head.event.view.id,v.id);
  assert.equal(head.admission.bindingEpoch,v.bindingEpoch);
  assert.equal(db.sql.prepare('SELECT value FROM vault').get().value,'synthetic');
  db.close();db=openDatabase(file);s=createWidgetStore(db);assert.equal(s.listViews('legacyw')[0].id,v.id);
  assert.deepEqual(db.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('legacy disabled becomes stopped and never retains backlog for later replay',t=>{
  const file=legacy(t,{status:'disabled'}),db=openDatabase(file);t.after(()=>{db.close();fs.rmSync(path.dirname(file),{recursive:true,force:true});});const s=createWidgetStore(db),w=s.get('legacyw');
  assert.equal(w.status,'stopped');assert.equal(w.stoppedReason,'old failure');assert.equal(w.pending,0);assert.equal(s.listViews(w.widgetId).length,1);
});
test('unknown legacy first send creates a separate candidate, not an invented view',t=>{
  const file=legacy(t,{messageId:null}),db=openDatabase(file);t.after(()=>{db.close();fs.rmSync(path.dirname(file),{recursive:true,force:true});});const s=createWidgetStore(db);
  assert.equal(s.listViews('legacyw').length,0);const candidates=s.listCandidates('legacyw');
  assert.equal(candidates.length,1);assert.deepEqual(candidates[0].target,{chatId:1});assert.equal(candidates[0].reason,'delivery_unknown');
});
test('invalid migration payload rolls back the schema and keeps legacy rows',t=>{
  const file=legacy(t),old=new DatabaseSync(file);old.prepare('UPDATE widget_events SET payload=?').run('bad json');old.close();
  assert.throws(()=>openDatabase(file));const db=new DatabaseSync(file);t.after(()=>{db.close();fs.rmSync(path.dirname(file),{recursive:true,force:true});});
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,14);
  assert.equal(db.prepare('SELECT payload FROM widget_events').get().payload,'bad json');
  assert.equal(db.prepare('SELECT messageId FROM widgets').get().messageId,7);
});
