import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareActionButtons} from '../../src/inline/buttons.mjs';
import {permitsAllow} from '../../src/messages/callbacks.mjs';

test('action buttons get opaque IDs, logical permits and multiple rows without exposing actions',()=>{
  let id=0;const result=prepareActionButtons({buttons:[[{text:'Start',action:'Start Wordle',key:'go',group:'start',permits:{'[start]go':[1]}}],[{text:'Again',action:'Repeat'}]]},{tipId:'tip',ids:()=>`id${++id}`});
  assert.equal(result.native.reply_markup.inline_keyboard.length,2);assert.equal(result.definitions.length,2);
  assert.deepEqual(result.native.reply_markup.inline_keyboard[0][0],{text:'Start',callback_data:'i:id1'});
  assert.equal(result.definitions[0].callbackKey,'[start]go');assert.equal(result.definitions[0].action,'Start Wordle');assert.equal(result.definitions[0].tipId,'tip');
});
test('rich action buttons and a flat keyboard preserve URL/copy controls',()=>{
  const result=prepareActionButtons({buttons:[{text:'URL',url:'https://example.com'},{text:'Copy',copy_text:{text:'x'}}],rich_message:{blocks:[{type:'buttons',buttons:[{text:'Start',action:'Start'}]},{type:'paragraph',text:[{type:'button',button:{text:'Nested',action:'Nested'}}]}]}},{tipId:'tip'});
  assert.equal(result.native.reply_markup.inline_keyboard.length,1);assert.equal(result.definitions.length,2);assert.ok(result.native.rich_message.blocks[1].text[0].button.callback_data);
});
test('invalid action metadata and unsupported raw/game/pay callbacks fail before publication',()=>{
  for(const button of [{text:'x',action:''},{text:'x',action:'x',key:'['},{text:'x',action:'x',group:'a'.repeat(21)},{text:'x',action:'x',permits:{'*':[NaN]}},{text:'x',callback_data:'arbitrary'},{text:'x',pay:true},{text:'x',callback_game:{}}])assert.throws(()=>prepareActionButtons({buttons:[button]},{tipId:'tip'}));
  assert.throws(()=>prepareActionButtons({buttons:[Array.from({length:9},()=>({text:'x',action:'x'}))]},{tipId:'tip'}));
});
test('inline permits retain exact, longest prefix, wildcard and missing-match behavior',()=>{
  const rules={'[start]go':[1],'[start]*':[2],'*':null};
  assert.equal(permitsAllow(rules,'[start]go',2),false);assert.equal(permitsAllow(rules,'[start]other',2),true);assert.equal(permitsAllow(rules,'other',99),true);
  assert.equal(permitsAllow({'go':[]},'go',1),false);assert.equal(permitsAllow({'go':null},'unknown',1),false);assert.equal(permitsAllow(null,'go',99),true);
});
