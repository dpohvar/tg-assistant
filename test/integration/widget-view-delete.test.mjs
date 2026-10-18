import test from 'node:test';
import assert from 'node:assert/strict';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';
import {disabledRender} from '../../src/widgets/render.mjs';

test('confirmed message loss detaches only that view and queues onViewDelete once',async t=>{
  const deleted=[],f=await widgetFixture(t,{module:{onViewDelete(_ctx,event){deleted.push(event);}}}),one=await f.withOneView();
  const two=await f.manager.setView(f.scope,{widgetId:one.widgetId,send:{chatId:-100123}});
  f.failNextEdit('telegram_api_error','Bad Request: message to edit not found');
  const result=await f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:1}});await f.idle();
  assert.equal(f.store.getView(one.viewId),null);assert.ok(f.store.getView(two.viewId));
  assert.equal(deleted.length,1);assert.equal(deleted[0].view.id,one.viewId);assert.equal(deleted[0].reason,'message_not_found');
  assert.equal(result.renderErrors.length,0);assert.equal(f.notices.length,0);
});

test('ordinary payload errors preserve the view and never invoke onViewDelete',async t=>{
  const deleted=[],f=await widgetFixture(t,{module:{onViewDelete(_ctx,event){deleted.push(event);}}}),one=await f.withOneView();
  f.failNextEdit('telegram_api_error',"Bad Request: can't parse entities");await f.manager.update(f.scope,{widgetId:one.widgetId,state:{count:1}});await f.idle();
  assert.ok(f.store.getView(one.viewId));assert.equal(deleted.length,0);
});

test('detachment disables callback, URL and copy buttons in ordinary and rich content',()=>{
  const value={reply_markup:{inline_keyboard:[[{text:'A',callback_data:'x'},{text:'U',url:'https://example.com'},{text:'C',copy_text:{text:'x'}}]]},rich_message:{blocks:[{type:'buttons',buttons:[{text:'U',url:'https://example.com'}]},{type:'paragraph',text:[{type:'button',button:{text:'C',copy_text:{text:'x'}}}]}]}};
  const disabled=disabledRender(value);
  for(const button of [...disabled.reply_markup.inline_keyboard[0],disabled.rich_message.blocks[0].buttons[0],disabled.rich_message.blocks[1].text[0].button])assert.deepEqual(button,{text:button.text,disabled:{}});
  assert.ok(value.reply_markup.inline_keyboard[0][1].url);
});
