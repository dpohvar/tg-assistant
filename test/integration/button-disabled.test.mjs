import test from 'node:test';
import assert from 'node:assert/strict';
import {closeButtons} from '../../src/messages/callbacks.mjs';
test('closing rich and inline buttons replaces callback action with disabled action',()=>{
 const m={rich_message:{blocks:[{type:'buttons',buttons:[{text:'⬜️ Red',callback_data:'[g]r',style:'danger'}]}]},reply_markup:{inline_keyboard:[[{text:'⬜️ Blue',callback_data:'[g]b'}]]}};
 const closed=closeButtons(m,'g','[g]b');
 for(const b of [closed.rich_message.blocks[0].buttons[0],closed.reply_markup.inline_keyboard[0][0]]){assert.deepEqual(b.disabled,{});assert.equal(Object.hasOwn(b,'callback_data'),false);}
 assert.equal(closed.rich_message.blocks[0].buttons[0].text,'⬛️ Red'); assert.equal(closed.reply_markup.inline_keyboard[0][0].text,'✅ Blue');
 assert.equal(m.rich_message.blocks[0].buttons[0].callback_data,'[g]r');
});
