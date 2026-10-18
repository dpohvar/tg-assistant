import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {normalizeInlineResults} from '../../src/inline/results.mjs';

function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1),scope={botId:'b',agentId:a.agentId,chatId:1};
  db.saveMessage('b',{message_id:7,date:1,chat:{id:1,type:'private'},document:{file_id:'cached',file_unique_id:'u'}});
  return {db,scope,adapters:{db,access:createAccess(db)},proof:[{messageId:7,fileId:'cached'}]};}
test('friendly text/rich/default messages normalize alongside cached media without database writes',t=>{
  const f=fixture(t),prepared=normalizeInlineResults(f.scope,[{title:'Text',message:{text:'hello',entities:[{type:'bold',offset:0,length:5}],buttons:[{text:'Start',action:'Start Wordle'}]}},{title:'No photo',description:'Send a photo in private'},{native:{type:'document',title:'File',document_file_id:'cached'},file_sources:f.proof}],f.adapters);
  assert.deepEqual(prepared.map(item=>item.native.type),['article','article','document']);assert.equal(prepared[0].native.input_message_content.message_text,'hello');assert.equal(prepared[1].native.input_message_content.message_text,'✖️');
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,0);
});
test('every supported native URL/cached family preserves its native content and optional fields',t=>{
  const f=fixture(t),base='https://example.com/file';
  const values=[{type:'article',title:'A',input_message_content:{message_text:'text'}},
    {type:'photo',photo_url:base,thumbnail_url:base,show_caption_above_media:true},
    {type:'gif',gif_url:base,thumbnail_url:base,gif_duration:1},
    {type:'mpeg4_gif',mpeg4_url:base,thumbnail_url:base,mpeg4_width:100},
    {type:'video',video_url:base,mime_type:'video/mp4',thumbnail_url:base,title:'Video'},
    {type:'audio',audio_url:base,title:'Audio',performer:'Artist'},
    {type:'voice',voice_url:base,title:'Voice'},
    {type:'document',document_url:base,mime_type:'application/pdf',title:'Document'},
    {type:'location',latitude:1,longitude:2,title:'Place',live_period:60},
    {type:'venue',latitude:1,longitude:2,title:'Place',address:'Address'},
    {type:'contact',phone_number:'+123',first_name:'Test'}];
  for(const type of ['photo','gif','mpeg4_gif','sticker','document','video','voice','audio'])values.push({type,[type==='mpeg4_gif'?'mpeg4_file_id':`${type}_file_id`]:'cached',...(['document','video','voice'].includes(type)?{title:type}:{}),...(type==='document'?{mime_type:undefined}:{})});
  for(const input of values){for(const key of Object.keys(input))if(input[key]===undefined)delete input[key];const [item]=normalizeInlineResults(f.scope,[{native:input,file_sources:f.proof}],f.adapters);assert.equal(item.native.type,input.type);for(const [key,value]of Object.entries(input))assert.deepEqual(item.native[key],value);}
});

test('cached audio preserves optional metadata accepted by the Bot API parser',t=>{
  const f=fixture(t),native={type:'audio',audio_file_id:'cached',title:'Audio cached',performer:'Fixture',audio_duration:3,caption:'Cached audio control'};
  const [prepared]=normalizeInlineResults(f.scope,[{native,file_sources:f.proof}],f.adapters);
  for(const [key,value] of Object.entries(native))assert.equal(prepared.native[key],value);
});
test('nested uploads, games/invoices/pay, unproven files and bad MIME combinations are rejected atomically',t=>{
  const f=fixture(t);
  for(const media of ['attach://secret','file:local.png','C:\\local.png'])assert.throws(()=>normalizeInlineResults(f.scope,[{title:'Bad',message:{rich_message:{blocks:[{type:'photo',photo:{type:'photo',media}}]}}}],f.adapters),{code:'inline_upload_forbidden'});
  for(const native of [{type:'game',game_short_name:'game'},{type:'article',title:'Invoice',input_message_content:{title:'Pay',payload:'p',currency:'XTR',prices:[]}},{type:'document',document_file_id:'unknown',title:'Bad'},{type:'document',document_url:'https://example.com/file',mime_type:'application/octet-stream',title:'Bad'},{type:'article',title:'Bad',input_message_content:{message_text:'x'},reply_markup:{inline_keyboard:[[{text:'Pay',pay:true}]]}}])assert.throws(()=>normalizeInlineResults(f.scope,[{title:'Good',message:{text:'x'}},{native}],f.adapters));
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM inline_buttons').get().n,0);
});

test('photos move after other results with stable IDs, actions and order in both partitions',t=>{
  const f=fixture(t);
  f.db.saveMessage('b',{message_id:8,date:1,chat:{id:1,type:'private'},photo:[{file_id:'photo-id',file_unique_id:'p'}]});
  const prepared=normalizeInlineResults(f.scope,[
    {native:{type:'photo',id:'photo-first',photo_url:'https://example.com/photo.png',thumbnail_url:'https://example.com/thumb.png',reply_markup:{inline_keyboard:[[{text:'Choose',action:'Photo action'}]]}}},
    {id:'text-first',title:'First',message:{text:'First'}},
    {native:{type:'photo',id:'photo-second',photo_file_id:'photo-id'},file_sources:[{messageId:8,fileId:'photo-id'}]},
    {native:{type:'document',id:'document',title:'Document',document_file_id:'cached'},file_sources:f.proof},
    {id:'text-second',title:'Second',message:{text:'Second'}}
  ],f.adapters);
  assert.deepEqual(prepared.map(x=>x.native.id),['text-first','document','text-second','photo-first','photo-second']);
  assert.equal(prepared[3].definitions[0].action,'Photo action');
  assert.equal(prepared[3].native.reply_markup.inline_keyboard[0][0].callback_data,'i:'+prepared[3].definitions[0].btnId);
});
