import test from 'node:test';
import assert from 'node:assert/strict';
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

test('live fixture admission confines ordinary callbacks and reactions to the designated private route',()=>{
  const admit=update=>acceptanceUpdate(update,{ownerId:1});
  assert.equal(admit({inline_query:{from:{id:1}}}),true);
  assert.equal(admit({callback_query:{from:{id:1},inline_message_id:'unknown-chat-inline'}}),true);
  assert.equal(admit({message_reaction:{chat:{id:1},user:{id:1}}}),true);
  for(const update of [{message:{from:{id:1},chat:{id:-2}}},{callback_query:{from:{id:1},message:{chat:{id:-2}}}},{message_reaction:{user:{id:1},chat:{id:-2}}},{message_reaction:{user:{id:2},chat:{id:1}}},{callback_query:{from:{id:2},inline_message_id:'foreign'}},{poll:{id:'unattributed'}}])assert.equal(admit(update),false);
});
