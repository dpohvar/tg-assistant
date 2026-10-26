import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runInlineAcceptance,acceptanceEffects,acceptanceUpdate} from '../manual/inline-agent-acceptance.mjs';
test('live acceptance requires explicit config before creating a runtime',async()=>{
  let starts=0;await assert.rejects(runInlineAcceptance({argv:[],createRuntime:()=>{starts++;throw new Error('must not start');}}),/config/);assert.equal(starts,0);
});
test('fixture effects reject foreign targets and consume unknown send attempts',()=>{
  const guard=acceptanceEffects({botId:'b',ownerId:1,sends:1,edits:2});
  assert.throws(()=>guard.before('b','sendMessage',{chat_id:2}),/target/);
  guard.before('b','sendMessage',{chat_id:1});
  assert.throws(()=>guard.before('b','sendMessage',{chat_id:1}),/budget/);
  assert.throws(()=>guard.before('b','editMessageText',{inline_message_id:'foreign'}),/target/);
  guard.allowInline('known');guard.before('b','editMessageText',{inline_message_id:'known'});
});

test('native streaming acceptance allows only three quiet photo buffers',()=>{
  const guard=acceptanceEffects({botId:'b',ownerId:1,sends:3,quietPhotosOnly:true});
  assert.throws(()=>guard.before('b','sendMessage',{chat_id:1,text:'unexpected'}),/quiet photo/);
  assert.throws(()=>guard.before('b','sendPhoto',{chat_id:1,photo:'x'}),/quiet photo/);
  for(let i=0;i<3;i++)guard.before('b','sendPhoto',{chat_id:1,photo:'x',disable_notification:true});
  assert.throws(()=>guard.before('b','sendPhoto',{chat_id:1,photo:'x',disable_notification:true}),/budget/);
});

test('native acceptance admits the streaming case and releases its lock after close',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-stream-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'fixture.json');fs.writeFileSync(config,JSON.stringify({controllerActive:false,ownerId:1,botTelegramId:42,codexHome:root,codexExecutable:'fixture'}));
  const seen=[];
  await runInlineAcceptance({argv:['--config',config,'--case','streaming','--state-dir',path.join(root,'run'),'--duration-seconds','30'],createRuntime:async({mode})=>{seen.push(mode);return {run:async()=>seen.push('run'),close:async()=>seen.push('close')};}});
  assert.deepEqual(seen,['streaming','run','close']);assert.equal(fs.existsSync(path.join(root,'inline-calibration.lock')),false);
});

test('live fixture admission confines ordinary callbacks and reactions to the designated private route',()=>{
  const admit=update=>acceptanceUpdate(update,{ownerId:1});
  assert.equal(admit({inline_query:{from:{id:1}}}),true);
  assert.equal(admit({callback_query:{from:{id:1},inline_message_id:'unknown-chat-inline'}}),true);
  assert.equal(admit({message_reaction:{chat:{id:1},user:{id:1}}}),true);
  for(const update of [{message:{from:{id:1},chat:{id:-2}}},{callback_query:{from:{id:1},message:{chat:{id:-2}}}},{message_reaction:{user:{id:1},chat:{id:-2}}},{message_reaction:{user:{id:2},chat:{id:1}}},{callback_query:{from:{id:2},inline_message_id:'foreign'}},{poll:{id:'unattributed'}}])assert.equal(admit(update),false);
});

test('Wordle live fixture admits other players only on its known inline messages',()=>{
  const guard=acceptanceEffects({botId:'b',ownerId:1});guard.allowInline('wordle-view');
  const scope={ownerId:1,inlineMessageIds:guard.inline};
  const callback={from:{id:2},inline_message_id:'wordle-view',data:'menu:start'};
  assert.equal(acceptanceUpdate({callback_query:callback},scope),true);
  assert.equal(acceptanceUpdate({callback_query:{...callback,inline_message_id:'foreign'}},scope),false);
  assert.equal(acceptanceUpdate({callback_query:{...callback,message:{chat:{id:2}}}},scope),false);
  assert.equal(acceptanceUpdate({inline_query:{from:{id:2}}},scope),false);
});
