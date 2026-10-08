import test from 'node:test';import assert from 'node:assert/strict';
import {richHelp} from '../../src/messages/rich-help.mjs';
import {dynamicTools} from '../../src/codex/threads.mjs';
test('rich help covers every persistent native block and details/list nesting',()=>{
 const h=richHelp();const types=h.blocks.map(b=>b.type);
 assert.deepEqual(types,[ 'paragraph','heading','pre','footer','divider','mathematical_expression','anchor','list','blockquote','expandable_blockquote','pullquote','collage','slideshow','table','details','map','buttons','animation','audio','document','photo','video','voice_note']);
 assert.equal(h.detailsWithList.blocks[0].type,'details');assert.equal(h.detailsWithList.blocks[0].blocks[0].items[0].blocks[0].type,'paragraph');
 assert.ok(h.richText.some(t=>t.type==='reference_link'));assert.ok(h.unsupported.includes('thinking'));
 for(const name of ['send','edit'])assert.match(dynamicTools.find(t=>t.name===name).description,/rich_help/);
 assert.ok(dynamicTools.some(t=>t.name==='rich_help'));assert.notEqual(richHelp(),h);
});
