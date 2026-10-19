import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicTools,CodexAgent} from '../../src/codex/threads.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
test('inline results and alternative read/edit addresses reach the actual model tool schema',()=>{
  const result=dynamicTools.find(tool=>tool.name==='set_inline_results');assert.ok(result);assert.deepEqual(result.inputSchema.required,['requestId','results']);assert.ok(result.inputSchema.properties.results.items.properties.native);
  for(const name of ['read','edit']){const schema=dynamicTools.find(tool=>tool.name===name).inputSchema;assert.equal(schema.properties.inlineMessageId.type,'string');assert.ok(schema.oneOf);}
});

test('the model can keep an inline stream open using an optional boolean done parameter',()=>{
  const schema=dynamicTools.find(tool=>tool.name==='set_inline_results').inputSchema;
  assert.equal(schema.properties.done?.type,'boolean');assert.equal(schema.required.includes('done'),false);
});

test('agents can give audio buffers a stored title before reusing their file ID inline',()=>{
  const send=dynamicTools.find(tool=>tool.name==='send').inputSchema.properties;
  assert.deepEqual(send.title,{type:'string'});
  assert.deepEqual(send.performer,{type:'string'});
  const description=dynamicTools.find(tool=>tool.name==='set_inline_results').description;
  assert.match(description,/sendAudio|send with audio/);
  assert.match(description,/stored.*title/);
});
test('a superseded inline event cannot start a native turn after asynchronous session preparation',async()=>{
  let release;const gate=new Promise(r=>release=r),agent=Object.create(CodexAgent.prototype);
  agent.assertCurrent=()=>{};agent.session=async()=>{await gate;return {deleted:false,rpc:{request:()=>assert.fail('Must not start a turn')},pendingChildren:new Set()};};agent.filterEvents=()=>[];
  const work=agent.run({agentId:'a'},[{eventType:'inline',requestId:'old'}],()=>{});release();assert.equal(await work,undefined);
});

test('native Windows agent startup requests the same strict MXC backend as widget execution',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-mxc-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});let args;
  const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath},prepareMcpArgs:async value=>{args=value.args;throw new Error('preflight captured');}});
  t.after(async()=>{await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
  await assert.rejects(agent.session({botId:'b',agentId:'a'},()=>{}),/preflight captured/);
  assert.equal(args.includes('prefer_mxc'),process.platform==='win32');
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.some(arg=>arg.startsWith('permissions.tg-agent.filesystem=')));
});

test('preflight and cancelled first input do not persist an empty native thread for restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-empty-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);
  const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath,defaultTimezone:'UTC'},spawnArgs:[path.resolve('test/fixtures/codex-server.mjs')]});
  t.after(async()=>{await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
  const calls=[],invoke=async name=>{calls.push(name);return {messageIds:[1]};};
  await agent.session(scope,invoke);assert.equal(db.agent('b',1).threadId,null);
  agent.filterEvents=()=>[];
  await agent.run(scope,[{eventType:'inline',requestId:'cancelled'}],invoke);
  assert.equal(db.agent('b',1).threadId,null);assert.deepEqual(calls,[]);
  agent.filterEvents=undefined;
  await agent.run(scope,[{eventType:'message',textPlain:'Actual input'}],invoke);
  assert.equal(db.agent('b',1).threadId,'thread1');assert.deepEqual(calls,['send']);
});
