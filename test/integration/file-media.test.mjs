import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createMessages} from '../../src/messages/actions.mjs';
import {BotFiles} from '../../src/files/paths.mjs';
import {dynamicTools} from '../../src/codex/threads.mjs';
import {createController} from '../../src/controller.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-file-media-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'wiki'));
  fs.writeFileSync(path.join(root,'wiki','image #100%.png'),'image-bytes');
  fs.writeFileSync(path.join(root,'wiki','report.pdf'),'pdf-bytes');
  const files=new BotFiles(root,'agent'),calls=[];
  let reads=0;
  const messages=createMessages({db:{saveMessage(){},getMessage:()=>({message_id:7,photo:[{file_id:'old'}]})},access:{assertWrite(){}},assertCurrent(){},
    uploads:async(_scope,local)=>Object.entries(local??{}).map(([name,file])=>{reads++;return {name,filename:path.basename(file),bytes:files.read(file)};}),
    telegram:{call:async(_bot,method,args,options)=>{calls.push({method,args,options});return {message_id:7};}}});
  return {messages,calls,root,reads:()=>reads,scope:{botId:'b',chatId:1}};
}
const image='file:wiki/image #100%.png';

test('file references use scoped bytes and preserve the caller input',async t=>{
  const f=fixture(t),input={photo:image,caption:'file:caption.png'};
  assert.deepEqual(await f.messages.send(f.scope,input),{messageIds:[7]});
  const {args,options}=f.calls[0];
  assert.match(args.photo,/^attach:\/\//);
  assert.equal(options.uploads[0].name,args.photo.slice(9));
  assert.equal(options.uploads[0].bytes.toString(),'image-bytes');
  assert.equal(options.uploads[0].filename,'image #100%.png');
  assert.equal(args.caption,input.caption);assert.equal(input.photo,image);
  assert.equal(args.uploads,undefined);
});

for(const format of ['html','markdown'])test(`rich ${format} keeps markup and resolves only the media table`,async t=>{
  const f=fixture(t),markup=format==='html'?'<img src="tg://photo?id=pic"/><code>file:wiki/absent</code>':'![](tg://photo?id=pic)\n\n`file:wiki/absent`';
  const rich_message={[format]:markup,media:[{id:'pic',media:{type:'photo',media:image}}]};
  await f.messages.send(f.scope,{rich_message});
  const sent=f.calls[0];assert.equal(sent.args.rich_message[format],markup);
  assert.match(sent.args.rich_message.media[0].media.media,/^attach:\/\//);
  assert.equal(sent.options.uploads.length,1);assert.equal(rich_message.media[0].media.media,image);
});

test('nested rich blocks and albums prepare media, covers and thumbnails',async t=>{
  const f=fixture(t);
  await f.messages.send(f.scope,{rich_message:{blocks:[{type:'details',summary:'More',blocks:[{type:'list',items:[{blocks:[{type:'photo',photo:{type:'photo',media:image}}]}]}]}]}});
  assert.equal(f.calls[0].options.uploads.length,1);
  await f.messages.send(f.scope,{media:[{type:'video',media:'file:wiki/report.pdf',thumbnail:image,cover:image}]});
  const c=f.calls[1];assert.equal(c.options.uploads.length,3);
  for(const field of ['media','thumbnail','cover'])assert.match(c.args.media[0][field],/^attach:\/\//);
});

test('all files are read before effects and invalid paths report local errors',async t=>{
  const f=fixture(t);
  for(const media of ['file:../outside.png','file:.temp/another/image.png','file:wiki/missing.png']) {
    const result=await f.messages.send(f.scope,{media:[{type:'photo',media:image},{type:'photo',media}]});
    assert.equal(result.error,'file_unavailable');
  }
  assert.equal(f.calls.length,0);
});

test('ordinary media objects fail before file reads or Telegram',async t=>{
  const f=fixture(t);
  for(const photo of [{type:'photo',media:image},[image],null,42]){
    const result=await f.messages.send(f.scope,{photo});assert.equal(result.error,'invalid_argument');
    assert.match(result.description,/photo/);
  }
  assert.equal(f.reads(),0);assert.equal(f.calls.length,0);
});

test('nonmedia text, buttons and unknown metadata never trigger local reads',async t=>{
  const f=fixture(t),input={text:'file:wiki/missing.png',entities:[{type:'text_link',url:'file:wiki/missing.png'}],reply_markup:{inline_keyboard:[[{text:'file:wiki/missing.png',callback_data:'file:wiki/missing.png'}]]},extra:{photo:'file:wiki/missing.png'}};
  await f.messages.send(f.scope,input);assert.equal(f.reads(),0);assert.deepEqual(f.calls[0].args,{...input,chat_id:1});
});

test('rich formatting metadata cannot introduce media through an unsupported blocks property',async t=>{
  const f=fixture(t),input={rich_message:{blocks:[{type:'paragraph',text:'Text',blocks:[{type:'photo',photo:{type:'photo',media:'file:wiki/missing.png'}}]}]}};
  assert.deepEqual(await f.messages.send(f.scope,input),{messageIds:[7]});
  assert.equal(f.reads(),0);assert.deepEqual(f.calls[0].args.rich_message,input.rich_message);
});

test('file edits prepare attachments while preserving an omitted caption',async t=>{
  const f=fixture(t);
  const result=await f.messages.edit(f.scope,{messageId:7,media:{type:'photo',media:image}});
  assert.deepEqual(result.updated,['photo']);assert.match(f.calls[0].args.media.media,/^attach:\/\//);
  assert.equal(f.calls[0].options.uploads[0].bytes.toString(),'image-bytes');
});

test('legacy declarations coexist without generated attachment name collisions',async t=>{
  const f=fixture(t);
  await f.messages.send(f.scope,{media:[{type:'photo',media:image},{type:'document',media:'attach://local_media_0'}],uploads:{local_media_0:'wiki/report.pdf'}});
  const c=f.calls[0];assert.notEqual(c.args.media[0].media,c.args.media[1].media);
  assert.equal(c.options.uploads.length,2);
});

test('generated names cannot accidentally satisfy an undeclared legacy reference',async t=>{
  const f=fixture(t);
  const result=await f.messages.send(f.scope,{media:[{type:'photo',media:image},{type:'document',media:'attach://local_media_0'}]});
  assert.equal(result.error,'file_not_accessible');assert.equal(f.reads(),0);assert.equal(f.calls.length,0);
});

test('agent schemas expose file paths without an uploads map',()=>{
  for(const name of ['send','edit','sticker_set_create','sticker_set_edit']){
    const tool=dynamicTools.find(t=>t.name===name);
    assert.equal(tool.inputSchema.properties.uploads,undefined,name);assert.match(tool.description,/file:/);
  }
});

test('controller and Telegram transport produce actual multipart fields and bytes',async t=>{
  const f=fixture(t),db=openDatabase(':memory:'),botId=path.basename(f.root),requests=[];
  db.registerBot({botId,telegramId:42,username:'bot',ownerId:1});db.saveChat(botId,{id:1,type:'private'});
  const telegram=createTelegram({getToken:async()=> 'offline-placeholder',fetch:async(_url,options)=>{
    const form=await new Request('http://offline.invalid',{method:'POST',body:options.body,headers:options.headers}).formData();
    const rich=JSON.parse(form.get('rich_message')),name=rich.media[0].media.media.slice(9),file=form.get(name);
    assert.equal(file.name,'image #100%.png');assert.equal(Buffer.from(await file.arrayBuffer()).toString(),'image-bytes');
    assert.equal(form.has('uploads'),false);requests.push(rich);
    return {json:async()=>({ok:true,result:{message_id:7,date:1000,chat:{id:1,type:'private'}}})};
  }});
  const controller=createController({db,telegram,agent:{},config:{botsDir:path.dirname(f.root)}});
  t.after(async()=>{controller.close();await controller.idle();db.close();});
  const scope=controller.lifecycle.scope(db.ensureAgent(botId,1)),markdown='![](tg://photo?id=pic)';
  assert.deepEqual(await controller.invoke(scope,'send',{rich_message:{markdown,media:[{id:'pic',media:{type:'photo',media:image}}]}}),{messageIds:[7]});
  assert.equal(requests[0].markdown,markdown);
});

test('thumbnail references obey the same secret URL and declaration checks',async t=>{
  const f=fixture(t);
  for(const thumbnail of ['attach://undeclared','https://api.telegram.org/file/botSECRET/image.png']){
    const result=await f.messages.send(f.scope,{video:'known-file',thumbnail});
    assert.equal(result.error,'file_not_accessible');
  }
  assert.equal(f.calls.length,0);
});
