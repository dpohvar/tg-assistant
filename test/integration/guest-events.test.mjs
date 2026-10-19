import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitGuestMention,shortGuestMessage} from '../../src/guest/events.mjs';
import {guestMessage} from '../helpers/guest-fixture.mjs';
const bot={username:'bot',telegramId:42};
test('explicit guest mention uses native offsets and rich mention nodes only in the own body',()=>{
  assert.equal(explicitGuestMention(guestMessage({text:'😀 @BoT weather',entities:[{type:'mention',offset:3,length:4}]}),bot),true);
  assert.equal(explicitGuestMention(guestMessage({text:'weather',entities:[],reply_to_message:guestMessage()}),bot),false);
  assert.equal(explicitGuestMention(guestMessage({text:'@bot',entities:[]}),bot),false);
  assert.equal(explicitGuestMention(guestMessage({text:undefined,entities:undefined,caption:'@bot weather',caption_entities:[{type:'mention',offset:0,length:4}]}),bot),true);
  const rich=rich_message=>guestMessage({text:undefined,entities:undefined,rich_message});
  assert.equal(explicitGuestMention(rich({blocks:[{type:'paragraph',text:{type:'mention',username:'BoT',text:'@BoT'}}]}),bot),true);
  assert.equal(explicitGuestMention(rich({blocks:[{type:'paragraph',text:'@bot'}]}),bot),false);
  assert.equal(explicitGuestMention(rich({reference_messages:[{type:'mention',username:'bot'}]}),bot),false);
});
test('compact guest events keep preview conventions without ordinary selectors',()=>{
  const m=guestMessage({text:'😀'.repeat(1001),via_bot:{username:'bold'},reply_to_message:{message_id:4},media_group_id:'album',message_thread_id:5,photo:[{width:4,height:4,file_id:'private-file-id'}]});
  const event=shortGuestMessage(m,'request');
  assert.equal(event.eventType,'guest_message');assert.equal(event.guestRequestId,'request');assert.equal(event.chatType,'supergroup');
  assert.equal([...event.textPlain].length,1000);assert.equal(event.truncated,true);assert.equal(event.photo,'4x4');assert.equal(event.viaBot,'bold');
  for(const key of ['messageId','chatId','replyTo','topicId','albumId','guest_query_id','file_id'])assert.equal(key in event,false,key);
});
