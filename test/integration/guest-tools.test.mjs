import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicTools} from '../../src/codex/threads.mjs';
import {WIDGET_TOOL_SCHEMAS} from '../../src/widgets/contract.mjs';
import {GUEST_INSTRUCTIONS} from '../../src/guest/contract.mjs';
const schema=name=>dynamicTools.find(t=>t.name===name).inputSchema;
test('guest read adds a third exclusive address without changing ordinary or inline alternatives',()=>{
  assert.equal(schema('read').properties.guestRequestId.type,'string');assert.equal(schema('read').oneOf.length,3);
  assert.ok(schema('read').oneOf.some(x=>x.required.includes('messageIds')));assert.ok(schema('read').oneOf.some(x=>x.required.includes('inlineMessageId')));assert.ok(schema('read').oneOf.some(x=>x.required.includes('guestRequestId')));
});
test('guest send exposes existing content action rows and required native metadata',()=>{
  const send=schema('send');
  for(const key of ['guestRequestId','text','rich_message','photo','animation','video','audio','voice','sticker','document','location','venue','contact','buttons','file_sources','thumbnail_url','mime_type','duration','width','height'])assert.ok(send.properties[key],key);
  assert.equal(send.oneOf.length,2);assert.match(dynamicTools.find(t=>t.name==='send').description,/guestRequestId/);
  assert.ok(send.oneOf[1].not.anyOf.some(rule=>rule.required.includes('chatId')));
});
test('guest widget schema shares the send envelope without exposing a local publication lock',()=>{
  const send=WIDGET_TOOL_SCHEMAS.set_widget_view.properties.send;
  assert.equal(send.properties.guestRequestId.type,'string');assert.equal(send.oneOf.length,2);
  assert.match(dynamicTools.find(t=>t.name==='set_widget_view').description,/guestRequestId/);
  assert.equal(schema('send').properties.origin,undefined);assert.equal(send.properties.reservation,undefined);
});
test('guest instructions distinguish public output optional answers buffers and no hard answer count',()=>{
  for(const pattern of [/guest_message/,/public/i,/at most one/i,/unanswered/i,/read\(\{guestRequestId\}\)/,/set_widget_view/,/buffer chat/i,/private history/i,/does not enforce/i])assert.match(GUEST_INSTRUCTIONS,pattern);
  assert.equal(dynamicTools.some(t=>t.name==='answer_guest'),false);
});
