import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createUsageStore} from '../../src/storage/usage.mjs';
import {usageReport,parseUsageReport} from '../../src/commands/usage.mjs';
import {createCommands} from '../../src/commands/router.mjs';
const now=Date.parse('2026-10-11T15:00:00Z');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-usage-report-')),db=openDatabase(path.join(root,'db'));t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});for(const [id,name,input]of [[42,'small',100],[43,'large',1000]]){db.registerBot({botId:'b'+id,telegramId:id,username:name,ownerId:1});const store=createUsageStore(db);store.track('b'+id,'a'+id,'r'+id,{now});store.tokens('r'+id,{inputTokens:input,outputTokens:10,cachedInputTokens:0,reasoningOutputTokens:0,cacheWriteInputTokens:0,totalTokens:input+10},now);}return {db,usage:createUsageStore(db)};}
test('master reports list sorted bots, sum all, show periods and preserve exact image bytes',t=>{
 const{db,usage}=fixture(t);usage.image('r42','pic','started',0,now);usage.image('r42','pic','completed',48024781,now);
 const list=usageReport({db,args:[],now});assert(list.text.indexOf('@large')<list.text.indexOf('@small'));assert.equal(parseUsageReport(list.text).rows.length,2);
 const all=usageReport({db,args:['all'],now});assert.match(all.text,/1,100 in/);assert.match(all.text,/48,024,781 bytes/);
 const hours=usageReport({db,args:['@small','hours'],now});assert.match(hours.text,/2026-10-11T15.*in progress/);assert.throws(()=>usageReport({db,args:['all','hours'],now}));assert.throws(()=>usageReport({db,args:['*'],now}));
});
test('reply comparisons use report IDs and exact counters, sorting by input increase',t=>{
 const{db,usage}=fixture(t),prior=usageReport({db,args:[],now});usage.tokens('r42',{inputTokens:400,outputTokens:20,cachedInputTokens:0,reasoningOutputTokens:0,cacheWriteInputTokens:0,totalTokens:420},now+60000);
 const reply={message_id:5,date:now/1000,text:prior.text,from:{id:99}};
 const current=usageReport({db,args:[],reply,masterTelegramId:99,now:now+60000});assert(current.text.indexOf('@small')<current.text.indexOf('@large'));assert.match(current.text,/Change over 1m/);assert.match(current.text,/\+300 in \/ \+10 out/);
 assert.throws(()=>usageReport({db,args:[],reply:{...reply,from:{id:98}},masterTelegramId:99,now}),/master/i);assert.throws(()=>usageReport({db,args:[],reply:{...reply,edit_date:now/1000},masterTelegramId:99,now}),/edited/i);
 assert.throws(()=>parseUsageReport(prior.text.replace('100 in','-100 in')));assert.throws(()=>parseUsageReport('/usage @small'));
});
test('reports truncate at complete blocks and do not exceed entity or text limits',t=>{
 const{db}=fixture(t);for(let i=100;i<200;i++)db.registerBot({botId:'b'+i,telegramId:i,username:'name_'+i,ownerId:1});const output=usageReport({db,args:[],now});assert(output.text.length<=4000);assert(output.entities.length<=100);assert.match(output.text,/Output truncated/);assert(parseUsageReport(output.text).rows.length>0);
 for(const e of output.entities)assert(e.offset+e.length<=output.text.length);
});
test('usage is private master-owner only, accepts normal formatting, replies and has help',async t=>{
 const{db}=fixture(t),sent=[];const commands=createCommands({db,config:{serviceOwnerId:1,masterTelegramId:99},telegram:{async call(bot,method,args){sent.push({bot,method,args});return {};}}});
 const message={message_id:7,date:now/1000,from:{id:1},chat:{id:1,type:'private'},text:'/usage @small'};
 await commands.handle('master',message);assert.match(sent[0].args.text,/@small/);assert.equal(sent[0].args.reply_parameters.message_id,7);assert(sent[0].args.entities.length);
 sent.length=0;await commands.handle('master',{...message,from:{id:2}});await commands.handle('master',{...message,chat:{id:-1,type:'group'}});assert.equal(sent.length,0);
 await commands.handle('master',{...message,text:'/help usage'});assert(sent.some(s=>s.args.text.includes('hours')));
 sent.length=0;await commands.handle('b42',message);assert(sent.every(s=>!s.args.text.includes('Total from')));
});
test('reply identity survives rename/removal, all comparisons work, reset and malformed snapshots fail safely',t=>{
 const{db,usage}=fixture(t),prior=usageReport({db,args:['@small'],now});db.sql.prepare("UPDATE bots SET username='renamed' WHERE telegramId=42").run();const reply={from:{id:99},date:now/1000,text:prior.text};
 const updated=usageReport({db,args:[],reply,masterTelegramId:99,now:now+1000});assert.match(updated.text,/@renamed/);assert.match(updated.text,/\+0 in/);
 db.sql.prepare('DELETE FROM bots WHERE telegramId=42').run();assert.match(usageReport({db,args:[],reply,masterTelegramId:99,now:now+1000}).text,/removed/);
 const all=usageReport({db,args:['all'],now});assert.match(usageReport({db,args:[],reply:{...reply,text:all.text},masterTelegramId:99,now:now+2000}).text,/all usage:/);
 assert.throws(()=>usageReport({db,args:[],reply:{...reply,forward_origin:{type:'user'}},masterTelegramId:99,now}));
 for(const text of [prior.text+'\n\nmalformed',prior.text.replace('100 in','9,999,999,999,999,999,999 in'),prior.text+'\n\n'+prior.text.slice(14)])assert.throws(()=>parseUsageReport(text));
 db.sql.prepare("UPDATE usage_buckets SET counters=? WHERE telegramId=42 AND kind='total'").run(JSON.stringify({inputTokens:0,outputTokens:0,imageGenerations:0,imageBytes:0}));assert.match(usageReport({db,args:[],reply,masterTelegramId:99,now:now+1000}).text,/Counters reset/);
});
