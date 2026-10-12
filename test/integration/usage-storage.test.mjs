import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createUsageStore} from '../../src/storage/usage.mjs';
import {DatabaseSync} from 'node:sqlite';
const at=Date.parse('2026-12-31T23:59:00Z');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-usage-')),db=openDatabase(path.join(root,'db'));t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});return {db,usage:createUsageStore(db),root};}
const tokens=(input,output=10)=>({inputTokens:input,outputTokens:output,cachedInputTokens:Math.floor(input/2),reasoningOutputTokens:2,cacheWriteInputTokens:0,totalTokens:input+output});
test('usage updates five UTC levels atomically, deduplicates replay and persists baselines',t=>{
 const {db,usage}=fixture(t);usage.track('b','a','r',{now:at});usage.tokens('r',tokens(100),at);usage.tokens('r',tokens(100),at);usage.tokens('r',tokens(130,12),at+120000);
 assert.equal(usage.list()[0].total.inputTokens,130);assert.equal(usage.list()[0].total.outputTokens,12);assert.equal(usage.periods(42,'hours',at+120000).length,2);assert.equal(db.sql.prepare('SELECT count(*) n FROM usage_buckets WHERE kind=?').get('total').n,1);
 createUsageStore(db).tokens('r',tokens(130,12),at+120000);assert.equal(usage.list()[0].total.inputTokens,130);
});
test('existing sessions seed first baseline, while children and fresh threads count independently',t=>{
 const {usage}=fixture(t);usage.track('b','a','old',{seed:true,now:at});usage.tokens('old',tokens(1000),at);usage.tokens('old',tokens(1100,20),at);usage.track('b','a','child',{rootThreadId:'old',now:at});usage.tokens('child',tokens(50),at);assert.equal(usage.list()[0].total.inputTokens,150);
 usage.track('b','a','fresh',{now:at});usage.tokens('fresh',tokens(25),at);assert.equal(usage.list()[0].total.inputTokens,175);
});
test('image start and completion are independently idempotent and record file size, not copies',t=>{
 const {usage}=fixture(t);usage.track('b','a','r',{now:at});for(let i=0;i<2;i++){usage.image('r','i','started',0,at);usage.image('r','i','completed',983017,at);}
 usage.image('r','failed','started',0,at);usage.image('r','failed','completed',0,at);
 assert.equal(usage.list()[0].total.imageGenerations,2);assert.equal(usage.list()[0].total.imageBytes,983017);
});
test('retention uses UTC calendar slots, retains years and totals and removed identities',t=>{
 const {db,usage}=fixture(t);usage.track('b','a','r',{now:at});usage.tokens('r',tokens(100),at);usage.tokens('r',tokens(120),Date.parse('2031-12-31T23:59Z'));usage.cleanup(Date.parse('2031-12-31T23:59Z'));
 assert.equal(usage.periods(42,'hours',Date.parse('2031-12-31T23:59Z')).length,1);assert.equal(usage.periods(42,'years',Date.parse('2031-12-31T23:59Z')).length,2);
 db.sql.prepare('DELETE FROM bots WHERE botId=?').run('b');assert.equal(usage.list()[0].removed,true);assert.equal(usage.list()[0].total.inputTokens,120);
 db.registerBot({botId:'different',telegramId:42,username:'renamed',ownerId:2});usage.sync();assert.equal(usage.list()[0].username,'renamed');assert.equal(usage.list()[0].removed,false);assert.equal(usage.list()[0].total.inputTokens,120);
});
test('invalid and decreasing counters cannot corrupt aggregate values',t=>{
 const {usage}=fixture(t);usage.track('b','a','r',{now:at});usage.tokens('r',tokens(100),at);assert.throws(()=>usage.tokens('r',tokens(-1),at));usage.tokens('r',tokens(10),at);assert.equal(usage.list()[0].total.inputTokens,100);usage.tokens('r',tokens(20),at);assert.equal(usage.list()[0].total.inputTokens,100);usage.tokens('r',tokens(130),at);assert.equal(usage.list()[0].total.inputTokens,130);
});
test('schema 11 migrates once, preserves private state and retains baselines across database reopen',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-usage-migrate-')),file=path.join(root,'db');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let old=new DatabaseSync(file);
 for(let i=1;i<=11;i++)old.exec(fs.readFileSync(new URL(`../../src/storage/migrations/${String(i).padStart(3,'0')}.sql`,import.meta.url),'utf8'));
 old.exec("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',42,'bot',1);INSERT INTO vault VALUES('b','KEEP','synthetic')");old.close();let db=openDatabase(file),store=createUsageStore(db);const start=store.startedAt();store.track('b','a','r',{now:at});store.tokens('r',tokens(100),at);db.close();
 db=openDatabase(file);store=createUsageStore(db);try{assert.equal(store.startedAt(),start);assert.equal(db.sql.prepare('SELECT value FROM vault').get().value,'synthetic');assert.equal(db.sql.prepare('SELECT max(version) v FROM schema_migrations').get().v,13);store.tokens('r',tokens(100),at);assert.equal(store.list()[0].total.inputTokens,100);}finally{db.close();}
});
test('bucket overflow rolls back the entire delta including the session baseline',t=>{
 const{db,usage}=fixture(t);usage.track('b','a','r',{now:at});usage.tokens('r',tokens(100),at);
 const original=JSON.parse(db.sql.prepare("SELECT counters FROM usage_buckets WHERE kind='hour'").get().counters);original.inputTokens=Number.MAX_SAFE_INTEGER;db.sql.prepare("UPDATE usage_buckets SET counters=? WHERE kind='hour'").run(JSON.stringify(original));assert.throws(()=>usage.tokens('r',tokens(120),at),/overflow/);
 assert.equal(usage.list()[0].total.inputTokens,100);assert.equal(JSON.parse(db.sql.prepare('SELECT counters FROM usage_threads').get().counters).inputTokens,100);
});
test('retention keeps exactly 24 hours, 30 days and 12 months and releases completed child dedup',t=>{
 const{db,usage}=fixture(t);usage.track('b','a','r',{now:at});let input=0;
 for(let i=0;i<400;i++)usage.tokens('r',tokens(++input),at+i*86400000);
 const end=at+399*86400000;assert.equal(usage.periods(42,'months',end).length,12);assert.equal(usage.periods(42,'days',end).length,30);assert.equal(usage.periods(42,'hours',end).length,1);
 for(let i=0;i<25;i++)usage.tokens('r',tokens(++input),end+i*3600000);assert.equal(usage.periods(42,'hours',end+24*3600000).length,24);
 usage.track('b','a','c',{rootThreadId:'r',now:end});usage.image('c','x','started',0,end);usage.finish('c',end);usage.cleanup(end+8*86400000);assert.equal(db.sql.prepare('SELECT count(*) n FROM usage_images').get().n,0);assert.equal(usage.list()[0].total.inputTokens,input);
});
test('a genuine new-turn reset seeds a fresh baseline; stale replay must not reset it',t=>{
 const{usage}=fixture(t);usage.track('b','a','r',{now:at});usage.tokens('r',tokens(100),at,{turnId:'old'});
 usage.tokens('r',tokens(10),at,{turnId:'new',allowReset:true});usage.tokens('r',tokens(20),at,{turnId:'new',allowReset:true});assert.equal(usage.list()[0].total.inputTokens,110);
 usage.tokens('r',tokens(10),at,{turnId:'old'});usage.tokens('r',tokens(20),at,{turnId:'new'});assert.equal(usage.list()[0].total.inputTokens,110);
});
test('a resumed child remains accounted after old completion expiry and cleanup',t=>{
 const{db,usage}=fixture(t);usage.track('b','a','r',{now:at});usage.track('b','a','c',{rootThreadId:'r',now:at});usage.tokens('c',tokens(50),at);usage.finish('c',at);
 const later=at+8*86400000;usage.track('b','a','c',{rootThreadId:'r',now:later});usage.tokens('c',tokens(60),later);usage.cleanup(later);usage.tokens('c',tokens(70),later);assert.equal(usage.list()[0].total.inputTokens,70);assert(db.sql.prepare('SELECT 1 FROM usage_threads WHERE threadId=?').get('c'));
});
test('image dedup records expire while a saved root keeps its durable baseline',t=>{
 const{db,usage}=fixture(t);db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1);db.sql.prepare('UPDATE agents SET threadId=? WHERE agentId=?').run('r',a.agentId);
 usage.track('b',a.agentId,'r',{now:at});usage.tokens('r',tokens(100),at);usage.image('r','i','started',0,at);usage.image('r','i','completed',12,at);usage.cleanup(at+8*86400000);
 assert.equal(db.sql.prepare('SELECT count(*) n FROM usage_images').get().n,0);assert.equal(db.sql.prepare('SELECT count(*) n FROM usage_threads').get().n,1);assert.equal(usage.list()[0].total.imageBytes,12);
});
