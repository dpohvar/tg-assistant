import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicTools} from '../../src/codex/threads.mjs';
import {formatWidgets} from '../../src/commands/widgets-format.mjs';
import {widgetFixture} from '../helpers/widget-views-fixture.mjs';
import {messageChunks} from '../../src/commands/message-chunks.mjs';

test('long listings preserve address links and surrogate pairs at message boundaries',()=>{
  const address='-1001234567890/123',text='x'.repeat(4090)+address+'🙂tail';
  const chunks=messageChunks({text,entities:[{type:'text_link',offset:4090,length:address.length,url:'https://t.me/c/1234567890/123'}]});
  assert.equal(chunks.map(c=>c.text).join(''),text);
  const links=chunks.flatMap(c=>c.entities.filter(e=>e.type==='text_link').map(e=>c.text.slice(e.offset,e.offset+e.length)));
  assert.deepEqual(links,[address]);assert.ok(chunks.every(c=>c.text.length<=4096&&!/[\uD800-\uDBFF]$/.test(c.text)));
});

test('the model gets the complete widget API without stop, resume or legacy debug tools',()=>{
  const names=new Set(dynamicTools.map(tool=>tool.name));
  for(const name of ['create_widget','update_widget','set_widget_view','delete_widget_view','delete_widget','list_widgets','get_widget','widget_event'])assert.ok(names.has(name),name);
  for(const name of ['set_widget','widgets','widget_state','render_widget','resume_widget','stop_widget'])assert.equal(names.has(name),false,name);
});

test('widget listings link only group/channel addresses and retain literal IDs for every view',()=>{
  const result=formatWidgets([{widgetId:'w',agentId:'owner',status:'active',description:'Wordle',pending:0,views:[
    {id:'v1',target:{chatId:1,messageId:7},chatType:'private'},
    {id:'v2',target:{chatId:-100111,messageId:8},chatType:'supergroup'},
    {id:'v3',target:{chatId:-12,messageId:9},chatType:'group'},
    {id:'v4',target:{inlineMessageId:'opaque'},chatType:'group'},
  ]}],0,1,1);
  assert.match(result.text,/Views: 4/);for(const address of ['1/7','-100111/8','-12/9','opaque'])assert.ok(result.text.includes(address));
  const links=result.entities.filter(entity=>entity.type==='text_link');assert.equal(links.length,1);assert.equal(links[0].url,'https://t.me/c/111/8');
  assert.equal(result.text.slice(links[0].offset,links[0].offset+links[0].length),'-100111/8');
});

test('list capacity includes zero-view/stopped registrations and adding views does not consume slots',async t=>{
  const f=await widgetFixture(t),one=await f.withOneView();await f.manager.setView(f.scope,{widgetId:one.widgetId,send:{chatId:-100123}});
  const zero=await f.manager.create(f.scope,{handler:'a.tsx',description:'Zero'});await f.manager.disableOwner(f.store.get(zero.widgetId));
  const listed=await f.manager.list(f.scope);assert.equal(listed.canCreate,8);assert.equal(listed.items.length,2);assert.equal(listed.items.find(w=>w.widgetId===one.widgetId).viewCount,2);
});
