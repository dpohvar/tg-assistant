import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProbeUpdate,runInlineEventsProbe} from '../manual/inline-events-probe.mjs';
const context={ownerId:1,botTelegramId:42,marker:'unique fixture',callbackData:'opaque'};

test('passive probe observes matching group replies before private-route filtering',()=>{
  const reply={message:{message_id:8,chat:{id:-99},from:{id:1},reply_to_message:{message_id:7,text:'unique fixture',via_bot:{id:42}}}};
  assert.deepEqual(classifyProbeUpdate(reply,context),{type:'fixture_reply',route:'group',chatId:-99,messageId:8,replyTo:7});
  reply.message.chat.id=1;assert.equal(classifyProbeUpdate(reply,context).route,'private');
  reply.message.reply_to_message.text='other';assert.equal(classifyProbeUpdate(reply,context),null);
});

test('probe accepts only owner callbacks with its exact token and excludes unrelated message content',()=>{
  assert.equal(classifyProbeUpdate({callback_query:{from:{id:1},data:'opaque',inline_message_id:'inline'}},context).inlineMessageId,'inline');
  assert.equal(classifyProbeUpdate({callback_query:{from:{id:2},data:'opaque'}},context),null);
  assert.equal(classifyProbeUpdate({callback_query:{from:{id:1},data:'other'}},context),null);
  assert.equal(classifyProbeUpdate({message:{from:{id:1},chat:{id:-99},text:'unrelated'}},context),null);
});

test('unmatched group reactions are explicitly candidates and membership changes are recorded',()=>{
  assert.equal(classifyProbeUpdate({message_reaction:{user:{id:1},chat:{id:-99},message_id:7}},context).type,'reaction_candidate');
  assert.equal(classifyProbeUpdate({message_reaction:{user:{id:2},chat:{id:-99},message_id:7}},context),null);
  assert.equal(classifyProbeUpdate({my_chat_member:{from:{id:1},chat:{id:-99},new_chat_member:{user:{id:42},status:'administrator'}}},context).type,'membership_change');
});

test('passive event probe requires explicit config before any network activity',async()=>{
  await assert.rejects(runInlineEventsProbe({argv:[]}),/config/i);
});
