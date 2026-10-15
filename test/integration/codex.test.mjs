import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { CodexAgent, dynamicTools } from '../../src/codex/threads.mjs';
import {isolatedMcpArgs} from '../../src/mcp/runtime.mjs';

for (const resume of [false,true]) test(`all controller tools register together on thread ${resume?'resume':'start'}`, async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-tool-formats-')),db=openDatabase(':memory:');
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);
 if(resume)db.sql.prepare('UPDATE agents SET threadId=? WHERE agentId=?').run('thread1',scope.agentId);
 const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath,defaultTimezone:'UTC'},spawnArgs:[path.resolve('test/fixtures/codex-server.mjs')]});
 t.after(async()=>{await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 const session=await agent.session(scope,async()=>({}));
 assert.equal(session.threadId,'thread1');assert.equal(db.agent('b',1).threadId,'thread1');
});

test('retained widget IDs reach the model in a failed dynamic tool result',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-widget-tool-error-')),db=openDatabase(':memory:'),marker=path.join(root,'result.json');
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1);
 const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath,defaultTimezone:'UTC'},spawnArgs:[path.resolve('test/fixtures/codex-server.mjs'),'tool-error',marker]});
 t.after(async()=>{await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 await agent.run(a,[{textPlain:'fixture'}],async()=>{throw Object.assign(new Error('Storage failed'),{code:'storage_failed',widgetId:'w',confirmedMessageId:71});});
 const result=JSON.parse(fs.readFileSync(marker,'utf8'));
 assert.equal(result.success,false);
 const error=JSON.parse(result.contentItems[0].text);
 assert.equal(error.widgetId,'w');assert.equal(error.confirmedMessageId,71);
});

test('shutdown cancels and reaps the actual MCP configuration preflight process',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-preflight-rpc-')),db=openDatabase(path.join(root,'db.sqlite')),marker=path.join(root,'waiting');
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);
 const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath},spawnArgs:[path.resolve('test/fixtures/codex-server.mjs'),'blocked-config',marker],prepareMcpArgs:isolatedMcpArgs});
 t.after(async()=>{await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 const work=agent.run(scope,[],async()=>{});const rejected=assert.rejects(work,{code:'rules_replaced'});
 const end=Date.now()+5000;while(!fs.existsSync(marker)){if(Date.now()>end)throw Error('Preflight did not start');await new Promise(r=>setTimeout(r,10));}
 assert.equal(agent.processes.size,1);await agent.close();await rejected;assert.equal(agent.processes.size,0);assert.equal(agent.sessions.size,0);
});

for(const action of ['close','deleteSession','detach'])test(`MCP preflight cannot launch a model after ${action}`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-preflight-')),db=openDatabase(path.join(root,'db.sqlite'));
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);
 let release,entered=false,signal;const blocked=new Promise(r=>release=r);
 const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath,defaultTimezone:'UTC'},spawnArgs:[path.resolve('test/fixtures/codex-server.mjs')],prepareMcpArgs:async options=>{entered=true;signal=options.signal;await blocked;return options.args;}});
 t.after(async()=>{release();await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 const calls=[],work=agent.run(scope,[],async(...args)=>calls.push(args));work.catch(()=>{});await new Promise(r=>setImmediate(r));
 assert.equal(entered,true);if(action==='close')await agent.close();else await agent[action](scope.agentId);
 assert.equal(signal.aborted,true);release();await assert.rejects(work,{code:'rules_replaced'});
 assert.equal(agent.processes.size,0);assert.equal(calls.length,0);assert.equal(db.agent('b',1).threadId,null);
});
test('agent schemas expose the accepted message and discussion capabilities', () => {
  assert.equal(dynamicTools.some(tool => tool.name === 'listen'), false);
  const properties = name => dynamicTools.find(tool => tool.name === name).inputSchema.properties;
  for (const field of ['location', 'venue', 'contact', 'poll', 'dice', 'video_note', 'disable_notification', 'protect_content', 'caption_entities']) assert.ok(properties('send')[field], field);
  assert.ok(properties('edit').media); assert.ok(properties('search').discussion); assert.ok(properties('history').discussion);
  assert.ok(properties('copy').caption);
  for(const name of ['send','copy','forward','history','search'])assert.deepEqual(properties(name).topicId,{type:'integer',minimum:1});
  assert.ok(dynamicTools.some(tool=>tool.name==='topics'));
});
test('a saved unloaded thread can be deleted without resuming its agent', async () => {
  const calls = [], agent = new CodexAgent({ db: {}, config: {} });
  agent.catalog = { request: async (method, args) => { calls.push({ method, args }); return {}; }, close() {} };
  await agent.deleteSession('a1', 'saved-thread');
  assert.deepEqual(calls, [{ method: 'thread/delete', args: { threadId: 'saved-thread' } }]);
  assert.equal(agent.sessions.size, 0); agent.close();
});
test('deletion still removes the thread when interrupt reports an already finished turn', async () => {
  const calls = [], agent = new CodexAgent({ db: {}, config: {} });
  agent.sessions.set('a1', { threadId: 'saved', turnId: 'finished', rpc: {
    async request(method) { calls.push(method); if (method === 'turn/interrupt') throw new Error('No active turn'); return {}; },
    close() { calls.push('close'); },
  } });
  await agent.deleteSession('a1');
  assert.deepEqual(calls, ['turn/interrupt', 'thread/delete', 'close']);
  assert.equal(agent.sessions.size, 0);
});
test('intentional session deletion classifies rejected root and steer RPC as rules replacement', async () => {
  for (const kind of ['root', 'steer']) {
    let rejectRequest, rejectDone;
    const agent = new CodexAgent({ db: { agent: () => ({ model: 'test' }) }, config: {} });
    const s = { threadId: 'saved', turnId: kind === 'steer' ? 'active' : null, pendingChildren: new Set(), rpc: {
      request(method) { return ['turn/start', 'turn/steer'].includes(method) ? new Promise((_resolve, reject) => { rejectRequest = reject; }) : Promise.resolve({}); },
      waitFor() { return new Promise((_resolve, reject) => { rejectDone = reject; }); },
      close() { rejectRequest?.(new Error('Connection closed')); rejectDone?.(new Error('Connection closed')); },
    } };
    agent.sessions.set('a', s); agent.session = async () => s;
    const work = kind === 'root' ? agent.run({ agentId: 'a', botId: 'b', chatId: 1 }, [], async () => {}) : agent.steer('a', []);
    const rejected = assert.rejects(work, error => error.code === 'rules_replaced');
    await new Promise(resolve => setImmediate(resolve));
    await agent.deleteSession('a'); await rejected;
  }
});
test('intentional deletion during session initialization preserves the replacement classification', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-init-delete-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 }); db.saveChat('b', { id: 1, type: 'private' });
  const record = db.ensureAgent('b', 1), agent = new CodexAgent({ db, config: { botsDir: root, codexHome: root, codexExecutable: process.execPath, defaultTimezone: 'UTC' }, spawnArgs: [path.resolve('test/fixtures/codex-server.mjs'), 'delayed-init'] });
  t.after(async () => { await agent.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const work = agent.run(record, [], async () => ({}));
  const rejected = assert.rejects(work, error => error.code === 'rules_replaced');
  await new Promise(resolve => setImmediate(resolve));
  await agent.deleteSession(record.agentId); await rejected;
  assert.equal(agent.sessions.size, 0);
});
test('Codex session serializes event array and routes dynamic send to scoped tool', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-codex-')); const db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b1', telegramId: 42, username: 'test', ownerId: 123 }); db.saveChat('b1', { id: 123, type: 'private' }); const a = db.ensureAgent('b1', 123);
  const agent = new CodexAgent({ db, config: { botsDir: root, codexHome: root, codexExecutable: process.execPath, defaultTimezone: 'UTC' }, spawnArgs: [path.resolve('test/fixtures/codex-server.mjs')] });
  t.after(async () => { await agent.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const calls = [];
  await agent.run({ ...a, controllerId: 'test', generation: 1 }, [{ eventType: 'message', messageId: 1, textPlain: 'hello' }], async (name, args) => { calls.push({ name, args }); return { messageIds: [5] }; });
  assert.deepEqual(calls, [{ name: 'send', args: { text: 'hello' } }]);
  assert.equal(db.agent('b1', 123).threadId, 'thread1');
});
test('root completion releases the turn while background settlement waits for children', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-child-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'test', ownerId: 1 }); db.saveChat('b', { id: 1, type: 'private' }); const a = db.ensureAgent('b', 1);
  const agent = new CodexAgent({ db, config: { botsDir: root, codexHome: root, codexExecutable: process.execPath, defaultTimezone: 'UTC' }, spawnArgs: [path.resolve('test/fixtures/codex-server.mjs'), 'background'] });
  t.after(async () => { await agent.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await agent.run(a, [{ textPlain: 'hello' }], async () => ({ messageIds: [1] }));
  assert.ok(result?.settled instanceof Promise); assert.equal(agent.sessions.get(a.agentId).turnId, null);
  assert.equal(agent.hasBackground(a.agentId), true);
  let complete = false; result.settled.then(() => { complete = true; });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(complete, false);
  await result.settled; assert.equal(complete, true);
  assert.equal(agent.hasBackground(a.agentId), false); await agent.waitBackground(a.agentId);
});

test('rules version belongs to instructions read before awaited thread creation', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-rules-start-')), db=openDatabase(path.join(root,'db.sqlite'));
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1}); db.saveChat('b',{id:1,type:'private'}); const a=db.ensureAgent('b',1);
 const marker=path.join(root,'started'), version=db.getBot('b').rulesVersion;
 const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath,defaultTimezone:'UTC'},spawnArgs:[path.resolve('test/fixtures/codex-server.mjs'),'delayed-start',marker]});
 t.after(async()=>{await agent.close(); db.close(); fs.rmSync(root,{recursive:true,force:true});});
 agent.botProfile=async()=>({userId:42,username:'bot',name:'Test Bot',description:'Profile description',shortDescription:'Short profile'});
 const work=agent.session(a,async()=>({}));
 for(let i=0;i<100&&!fs.existsSync(marker);i++) await new Promise(r=>setTimeout(r,10));
 const instructions=fs.readFileSync(marker,'utf8'); assert.match(instructions,/Bot data/); assert.match(instructions,/Profile description/); assert.match(instructions,/Short profile/); assert.match(instructions,/\"userId\":42/);
 assert.match(instructions,/triggers lists why a group message was delivered/);assert.match(instructions,/mention:@username/);
 assert.match(instructions,/call user_roles to check their current role/);
 assert.match(instructions,/do not rely on memory or earlier results/);
 assert.match(instructions,/If the role is irrelevant to the current action, do not query it/);
  assert.match(instructions,/separate from Telegram chat administrator status/);
  assert.match(instructions,/One agent serves the whole forum chat/);
  assert.match(instructions,/Explicit General with a cross-topic or unknown reply is refused/);
  assert.match(instructions,/history\/search can filter topicId even after forum mode is disabled/);
  assert.match(instructions,/void acknowledges decorative buttons immediately without a handler or queue event/);
  assert.match(instructions,/event\.data\.data retains full callback_data/);
  assert.match(instructions,/system\/reserved action prefixes and void:payload are forbidden/);
 assert.ok(fs.existsSync(marker)); db.sql.prepare('UPDATE bots SET rulesVersion=rulesVersion+1 WHERE botId=?').run('b');
 await work; assert.equal(db.agent('b',1).threadRulesVersion,version); assert.notEqual(version,db.getBot('b').rulesVersion);
});

test('all dynamic array schemas specify their item types', () => {
  for (const tool of dynamicTools) for (const [name, schema] of Object.entries(tool.inputSchema.properties)) if (schema.type === 'array') assert.ok(schema.items, `${tool.name}.${name}`);
  for (const name of ['send', 'edit']) { const schema = dynamicTools.find(t => t.name === name).inputSchema.properties.file_sources.items; assert.equal(schema.type, 'object'); assert.deepEqual(schema.required, ['messageId', 'fileId']); }
});
