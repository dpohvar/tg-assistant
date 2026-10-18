import test from 'node:test';
import assert from 'node:assert/strict';
import * as media from '../manual/inline-media-all.mjs';
const {mixedMediaItems,runMixedMediaProbe}=media;

test('all-media fixture preserves mixed photo positions and labels native and rich articles separately',()=>{
  const results={text:[{native:{type:'article',id:'text',title:'Text'}}],photo:[{native:{type:'photo',id:'url',title:'Photo URL'}},{native:{type:'photo',id:'cached',title:'Photo cached'},file_sources:[{messageId:1,fileId:'p'}]}],sticker:[{native:{type:'sticker',id:'sticker',sticker_file_id:'s'}}],places:[{native:{type:'contact',id:'contact',first_name:'Inline'}}]};
  const items=mixedMediaItems(results);
  assert.deepEqual(items.map(i=>i.native.type),['article','article','photo','photo','sticker','contact']);
  assert.ok(items[1].native.input_message_content.rich_message);
  assert.equal(items[3].native.title,'[04] Photo cached');assert.deepEqual(items[3].file_sources,results.photo[1].file_sources);
  assert.equal(items[4].native.title,undefined);assert.equal(items[5].native.first_name,'[06] Inline');
  assert.equal(results.photo[1].native.title,'Photo cached');
});

test('raw media probe requires explicit configuration before any network activity',async()=>{
  await assert.rejects(runMixedMediaProbe({argv:[]}),/config/i);
});

test('thumbnail layout control has exact three-page order and thumbnails only on first-page articles',()=>{
  const photos=['blue','fruit'].map((id,index)=>({native:{type:'photo',id,photo_file_id:id},file_sources:[{messageId:index+1,fileId:id}]}));
  const pages=media.thumbnailProbePages(photos,'https://example.com/thumbnail.jpg');
  assert.deepEqual(pages.map(p=>p.map(i=>i.native.type)),[Array(10).fill('article'),['photo','article'],['article','photo','article']]);
  assert.ok(pages[0].every(i=>i.native.thumbnail_url==='https://example.com/thumbnail.jpg'));
  assert.ok(pages.slice(1).flat().filter(i=>i.native.type==='article').every(i=>i.native.thumbnail_url===undefined));
  assert.equal(pages[1][0].native.photo_file_id,'blue');assert.equal(pages[2][1].native.photo_file_id,'fruit');
  assert.equal(new Set(pages.flat().map(i=>i.native.id)).size,15);
});

test('plain first-page control changes only the first articles thumbnail fields',()=>{
  const photos=['a','b'].map(id=>({native:{type:'photo',id,photo_file_id:id}}));
  const withThumb=media.thumbnailProbePages(photos,'https://example.com/thumb.jpg');
  const plain=media.thumbnailProbePages(photos,'https://example.com/thumb.jpg',{thumbnails:false});
  for(const item of withThumb[0]){delete item.native.thumbnail_url;delete item.native.thumbnail_width;delete item.native.thumbnail_height;}
  assert.deepEqual(plain,withThumb);
});

test('layout pagination rejects foreign and replaced cursors and preserves repeated page contents',()=>{
  const pages=[[1],[2],[3]],pager=media.createLayoutPager(pages,1);
  const first=pager.receive({from:{id:1},query:'layout',offset:''});
  assert.deepEqual(first.results,[1]);assert.ok(first.next_offset);
  const second=pager.receive({from:{id:1},query:'layout',offset:first.next_offset});
  assert.deepEqual(second.results,[2]);assert.ok(second.next_offset);
  assert.deepEqual(pager.receive({from:{id:1},query:'layout',offset:first.next_offset}),second);
  assert.deepEqual(pager.receive({from:{id:2},query:'layout',offset:first.next_offset}).results,[]);
  const third=pager.receive({from:{id:1},query:'layout',offset:second.next_offset});assert.deepEqual(third.results,[3]);assert.equal(third.next_offset,'');
  pager.receive({from:{id:1},query:'fresh',offset:''});
  assert.deepEqual(pager.receive({from:{id:1},query:'layout',offset:first.next_offset}).results,[]);
});

test('avatar control uses one cached header followed by plain drum rows and mixed final photos',()=>{
  const photos=['blue','fruit'].map(id=>({native:{type:'photo',photo_file_id:id}}));
  const header={type:'photo',photo_file_id:'avatar',title:'Bot avatar'};
  const pages=media.avatarProbePages(photos,header);
  assert.deepEqual(pages.map(p=>p.length),[6,6,5]);
  assert.equal(pages[0][0].native.photo_file_id,'avatar');
  assert.deepEqual(pages[0][0].native.input_message_content,{message_text:'✖️'});
  assert.ok(pages.slice(0,2).flat().slice(1).every(i=>i.native.type==='article'&&!i.native.thumbnail_url&&i.native.title.startsWith('⬇️')));
  assert.deepEqual(pages[2].map(i=>i.native.type),['article','photo','article','photo','article']);
  assert.equal(header.input_message_content,undefined);
  const without=media.avatarProbePages(photos,null);
  assert.equal(without[0].length,6);assert.ok(without[0].every(i=>i.native.type==='article'));
});
