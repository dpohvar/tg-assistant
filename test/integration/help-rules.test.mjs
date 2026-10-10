import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createCommands} from '../../src/commands/router.mjs';
import {helpSections,helpMessages} from '../../src/commands/help.mjs';
import {createController} from '../../src/controller.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fixture(t) {
  const db=openDatabase(':memory:'); t.after(()=>db.close());
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  db.setRole('b',2,'admin'); db.setRole('b',3,'manager'); db.setRole('b',4,'user');
  const calls=[], writes=[];
  const router=createCommands({db,config:{dataDir:'.',serviceOwnerId:1},telegram:{call:async(b,method,p)=>{calls.push({method,...p});return {};}},updateRules:async(...args)=>writes.push(args)});
  const send=(text,extra={})=>router.handle('b',{message_id:8,from:{id:1},chat:{id:1,type:'private'},text,...extra});
  return {router,send,calls,writes};
}
test('inline rules preserve pre contents and ignore an invalid quoted document',async t=>{
  const f=fixture(t), value='  Be helpful.\n\nKeep spaces.  ', text='/rules set '+value;
  await f.send(text,{entities:[{type:'pre',offset:11,length:value.length}],reply_to_message:{from:{id:99},chat:{id:999},edit_date:10,document:{file_id:'unused'}}});
  assert.deepEqual(f.writes,[['b',{text:value},false]]);
  assert.match(f.calls.at(-1).text,/Правила обновлены/);
});
test('inline rules reject plain/code text, extras, whitespace and forbidden callers',async t=>{
  const f=fixture(t);
  for(const extra of [{},{entities:[{type:'code',offset:11,length:3}]},{entities:[{type:'pre',offset:11,length:3}],from:{id:4}},{entities:[{type:'pre',offset:11,length:3}],chat:{id:-1,type:'group'}}]) await f.send('/rules set abc',extra);
  await f.send('/rules set abc extra',{entities:[{type:'pre',offset:11,length:3}]});
  await f.send('/rules set   ',{entities:[{type:'pre',offset:11,length:2}]});
  assert.equal(f.writes.length,0);
});
test('a document replying to inline rules is not a rules upload',async t=>{
  const f=fixture(t);
  const text='/rules set abc';
  assert.equal(await f.send(undefined,{document:{file_id:'file'},reply_to_message:{text,entities:[{type:'pre',offset:11,length:3}],from:{id:1},chat:{id:1,type:'private'}}}),false);
  assert.equal(f.writes.length,0);
});
test('help is a formatted English section index and detailed role-aware command guide',async t=>{
  const f=fixture(t); await f.send('/help');
  const index=f.calls.map(x=>x.text).join('\n');
  assert.match(index,/\/help agent/); assert.match(index,/spoiler/); assert.doesNotMatch(index,/\/agent stop/);
  assert.ok(f.calls[0].entities.some(x=>x.type==='code'));
  f.calls.length=0; await f.send('/help user');
  const users=f.calls.map(x=>x.text).join('\n');
  for(const role of ['user','manager','admin','owner']) assert.match(users,new RegExp(role));
  assert.match(users,/inherit/i);assert.match(users,/BotFather|Telegram administrator/i);
  assert.doesNotMatch(users,/[А-Яа-я]{3}/);
  f.calls.length=0; await f.send('/help agent',{from:{id:4}});
  assert.doesNotMatch(f.calls.map(x=>x.text).join('\n'),/\/agent model|\/agent list|\/agent stop \*/);
});
test('long help stays complete, splits at entries and replies to the command',async t=>{
  const f=fixture(t); await f.send('/help agent');
  assert.ok(f.calls.length>1);
  for(const x of f.calls){assert.ok(x.text.length<=4000);assert.equal(x.reply_parameters.message_id,8);assert.doesNotMatch(x.text,/обрезано/);for(const e of x.entities)assert.ok(e.offset+e.length<=x.text.length);}
  assert.match(f.calls.map(x=>x.text).join('\n'),/\/agent models/);
});
test('every role/chat and master help has complete descriptions and valid formatted chunks',()=>{
  for(const role of [undefined,'user','manager','admin','owner'])for(const group of [false,true])for(const master of [false,true]){
    const sections=helpSections({role,group,master});
    if(master)assert.deepEqual(Object.keys(sections),['bot']);
    if(group)assert.equal(sections.user,undefined);
    for(const [name,s] of Object.entries(sections)){
      assert.ok(s.description);
      for(const c of s.commands){assert.ok(c.description,`${name}: ${c.syntax}`);assert.ok(c.description.length>60);}
    }
    for(const section of [undefined,...Object.keys(sections)])for(const m of helpMessages(sections,section)){
      assert.ok(m.text.length<=4000);assert.doesNotMatch(m.text,/undefined|[А-Яа-я]{3}/);
      for(const e of m.entities)assert.ok(m.text.slice(e.offset,e.offset+e.length).startsWith('/'));
    }
  }
});
test('controller saves inline rules exactly, updates version and removes idle context without downloading',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rules-inline-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});
  const a=db.ensureAgent('b',1);db.sql.prepare('UPDATE agents SET threadId=?,threadRulesVersion=rulesVersion FROM bots WHERE agentId=?').run('old',a.agentId);
  const deleted=[],calls=[];
  const controller=createController({db,config:{dataDir:root,botsDir:root},agent:{run:async()=>{},deleteSession:async(...x)=>deleted.push(x)},telegram:{call:async(b,method,p)=>{calls.push(method);return {};}}});
  t.after(async()=>{controller.close();await controller.idle();db.close();fs.rmSync(root,{recursive:true,force:true});});
  const value='  Be helpful.\nKeep accents: café 😎.  ';
  const before=db.getBot('b').rulesVersion;
  await controller.receive('b',{message:{message_id:9,date:1,from:{id:1},chat:{id:1,type:'private'},text:'/rules set '+value,entities:[{type:'pre',offset:11,length:value.length}]}});
  assert.equal(fs.readFileSync(path.join(root,'rules','b','AGENTS.md'),'utf8'),value);
  assert.equal(db.getBot('b').rulesVersion,before+1);assert.equal(db.agent('b',1).threadId,null);
  assert.deepEqual(deleted,[[a.agentId,'old']]);assert.ok(!calls.includes('getFile'));
});
test('inline rules wait for root and subagents before queued work uses fresh context',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rules-busy-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});
  const a=db.ensureAgent('b',1),version=db.getBot('b').rulesVersion;
  db.sql.prepare('UPDATE agents SET threadId=?,threadRulesVersion=?,notes=? WHERE agentId=?').run('old',version,'keep notes',a.agentId);
  let finish,finishChild;const turn=new Promise(r=>finish=r),child=new Promise(r=>finishChild=r),order=[];
  const controller=createController({db,config:{dataDir:root,botsDir:root},agent:{
    run:async()=>{order.push('run');if(order.length===1){await turn;return {settled:child};}},
    waitBackground:async()=>child,deleteSession:async()=>order.push('delete'),
  },telegram:{call:async()=>({})}});
  t.after(async()=>{finish();finishChild();controller.close();await controller.idle();db.close();fs.rmSync(root,{recursive:true,force:true});});
  const send=(text,id,entities=[])=>controller.receive('b',{message:{message_id:id,date:1,from:{id:1},chat:{id:1,type:'private'},text,entities}});
  await send('first',1);await new Promise(r=>setImmediate(r));
  await send('/rules set New rules',2,[{type:'pre',offset:11,length:9}]);await send('next',3);
  assert.deepEqual(order,['run']);assert.equal(db.agent('b',1).threadId,'old');
  finish();await new Promise(r=>setImmediate(r));assert.deepEqual(order,['run']);
  finishChild();await controller.idle();assert.deepEqual(order,['run','delete','run']);
  assert.equal(db.agent('b',1).notes,'keep notes');assert.equal(db.agent('b',1).threadId,null);
});
