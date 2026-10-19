import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {prepareGuestResult} from '../../src/guest/results.mjs';
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);db.saveMessage('b',{message_id:8,date:1,chat:{id:1,type:'private'},animation:{file_id:'cached',mime_type:'video/mp4'}});return {scope,options:{db,access:createAccess(db),origin:'agent'},proof:[{messageId:8,fileId:'cached'}]};}
test('guest text and native rich output preserve content and prepare existing action buttons',t=>{
  const f=fixture(t),body={text:'hello',entities:[{type:'bold',offset:0,length:5}],buttons:[[{text:'Start',action:'Start Wordle',group:'start',permits:{'*':[1]}}]]};
  const p=prepareGuestResult(f.scope,body,f.options);
  assert.equal(p.native.type,'article');assert.equal(p.native.title,'Response');assert.equal(p.native.input_message_content.message_text,'hello');assert.deepEqual(p.native.input_message_content.entities,body.entities);
  assert.equal(p.definitions[0].action,'Start Wordle');assert.equal(p.native.reply_markup.inline_keyboard[0][0].callback_data,'i:'+p.definitions[0].btnId);
  assert.equal(p.snapshot.text,'hello');assert.equal(JSON.stringify(p).includes('https://t.me/'),false);
  for(const rich_message of ['<b>Hello</b>',{blocks:[{type:'paragraph',text:'Hello'}]}]){
    const result=prepareGuestResult(f.scope,{rich_message},f.options);assert.deepEqual(result.native.input_message_content.rich_message,rich_message);
  }
});
test('guest conversion covers cached and URL media using native required metadata',t=>{
  const f=fixture(t),url='https://example.com/media',thumbnail_url='https://example.com/thumb.jpg';
  for(const [kind,type,key]of [['photo','photo','photo_file_id'],['video','video','video_file_id'],['audio','audio','audio_file_id'],['voice','voice','voice_file_id'],['document','document','document_file_id'],['sticker','sticker','sticker_file_id'],['animation','mpeg4_gif','mpeg4_file_id']]){
    const p=prepareGuestResult(f.scope,{[kind]:'cached',file_sources:f.proof,...(kind==='sticker'?{}:{caption:'Caption'})},f.options);
    assert.equal(p.native.type,type,kind);assert.equal(p.native[key],'cached');assert.ok(p.native.id);if(kind!=='sticker')assert.equal(p.native.caption,'Caption');
  }
  for(const [body,type,key]of [
    [{photo:url},'photo','photo_url'],[{video:url,thumbnail_url,mime_type:'video/mp4'},'video','video_url'],
    [{audio:url},'audio','audio_url'],[{voice:url},'voice','voice_url'],[{document:url,mime_type:'application/pdf'},'document','document_url'],
    [{animation:url,thumbnail_url,mime_type:'image/gif'},'gif','gif_url'],[{animation:url,thumbnail_url,mime_type:'video/mp4'},'mpeg4_gif','mpeg4_url']]){
    const p=prepareGuestResult(f.scope,body,f.options);assert.equal(p.native.type,type);assert.equal(p.native[key],url);
  }
});
test('guest location venue and contact retain their ordinary nested fields',t=>{
  const f=fixture(t);
  for(const [kind,value]of [['location',{latitude:1,longitude:2}],['venue',{latitude:1,longitude:2,title:'Cafe',address:'Here'}],['contact',{phone_number:'+123',first_name:'Test'}]]){
    const p=prepareGuestResult(f.scope,{[kind]:value},f.options);assert.equal(p.native.type,kind);for(const [k,v]of Object.entries(value))assert.equal(p.native[k],v);
    assert.deepEqual(p.snapshot[kind],value);
  }
});
test('guest conversion rejects unsupported fields uploads and ambiguous native metadata',t=>{
  const f=fixture(t);
  for(const body of [{},{text:'x',photo:'cached'},{text:'x',origin:'widget'},{text:'x',chatId:1},{text:'x',disable_notification:true},{text:'x',reply_parameters:{message_id:1}},{text:'x',uploads:{}},{poll:{}},{dice:{}},{video_note:'cached'},{media:[]},{sticker:'https://example.com/a.webp'},{video:'https://example.com/v.mp4'},{animation:'https://example.com/a'},{document:'https://example.com/a',mime_type:'application/json'},{text:'x',reply_markup:{keyboard:[['Hi']]}},{text:'x',buttons:[{text:'raw',callback_data:'raw'}]},{text:'x',parse_mode:'HTML',entities:[]}])assert.throws(()=>prepareGuestResult(f.scope,body,f.options),undefined,JSON.stringify(body));
  for(const photo of ['attach://file','file:image.png','C:\\image.png','https://api.telegram.org/file/botSECRET/image.png','unproven'])assert.throws(()=>prepareGuestResult(f.scope,{photo},f.options));
  assert.throws(()=>prepareGuestResult(f.scope,{text:'x',reply_markup:{inline_keyboard:[],keyboard:[['ordinary']]}},f.options),{code:'invalid_argument'});
});
test('trusted widget conversion preserves native handlers but does not permit uploads',t=>{
  const f=fixture(t),body={text:'Wordle',reply_markup:{inline_keyboard:[[{text:'Start',callback_data:'menu:start'}]]}};
  assert.throws(()=>prepareGuestResult(f.scope,body,f.options));
  const widget=prepareGuestResult(f.scope,body,{...f.options,origin:'widget'});assert.equal(widget.native.reply_markup.inline_keyboard[0][0].callback_data,'menu:start');assert.deepEqual(widget.definitions,[]);
  assert.equal(prepareGuestResult(f.scope,{photo:'known-widget-file'},{...f.options,origin:'widget'}).native.photo_file_id,'known-widget-file');
  assert.throws(()=>prepareGuestResult(f.scope,{photo:'attach://file'},{...f.options,origin:'widget'}));
});
