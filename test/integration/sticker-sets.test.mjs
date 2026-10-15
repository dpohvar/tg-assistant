import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {dynamicTools} from '../../src/codex/threads.mjs';

const input = {sticker:'file-one',format:'static',emoji_list:['🙂']};
const member = {file_id:'file-one',file_unique_id:'one',type:'regular',width:512,height:512,is_animated:false,is_video:false,emoji:'🙂',set_name:'Faces_by_bot'};
function fixture(t, hook = () => {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-sets-')), file=path.join(root,'db.sqlite');
  const db=openDatabase(file), calls=[], sets=new Map();
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  db.saveChat('b',{id:1,type:'private'});const own=db.ensureAgent('b',1);
  const telegram={async call(botId,method,args,options){
    calls.push({botId,method,args,options});const overridden=await hook(method,args,options);if(overridden!==undefined)return overridden;
    if(method==='getStickerSet')return sets.get(args.name.toLowerCase())??{name:args.name,title:'Faces',sticker_type:'regular',stickers:[member]};
    if(method==='createNewStickerSet'){sets.set(args.name.toLowerCase(),{name:args.name,title:args.title,sticker_type:args.sticker_type,stickers:[{...member,type:args.sticker_type}]});return true;}
    return true;
  }};
  const c=createController({db,telegram,agent:{},config:{botsDir:root}}),scope=c.lifecycle.scope(own);
  fs.mkdirSync(path.join(root,'b','wiki'),{recursive:true});fs.writeFileSync(path.join(root,'b','wiki','face.png'),'png-bytes');
  t.after(async()=>{c.close();await c.idle();db.close();fs.rmSync(root,{recursive:true,force:true});});
  return {db,file,root,c,scope,calls,sets,invoke:(tool,args={})=>c.invoke(scope,tool,args)};
}
const createArgs=(extra={})=>({name:'Faces_by_bot',title:'Faces',type:'regular',stickers:[input],...extra});

test('create uploads native sticker inputs and catalog survives reopen independently of agents',async t=>{
  const f=fixture(t);
  const result=await f.invoke('sticker_set_create',createArgs({stickers:[{...input,sticker:'attach://face'}],uploads:{face:'wiki/face.png'}}));
  assert.deepEqual(result,{status:'created',name:'Faces_by_bot',ownerUserId:1,link:'https://t.me/addstickers/Faces_by_bot'});
  assert.deepEqual(f.calls[0].args,{user_id:1,name:'Faces_by_bot',title:'Faces',sticker_type:'regular',stickers:[{...input,sticker:'attach://face'}]});
  assert.equal(f.calls[0].options.uploads[0].bytes.toString(),'png-bytes');
  f.db.sql.prepare('DELETE FROM agents WHERE agentId=?').run(f.scope.agentId);
  const reopened=openDatabase(f.file);try{assert.equal(reopened.sql.prepare('SELECT ownerUserId FROM sticker_sets').get().ownerUserId,1);}finally{reopened.close();}
});

test('custom emoji owner and repainting are explicit; catalog is shared within one bot only',async t=>{
  const f=fixture(t);
  await f.invoke('sticker_set_create',createArgs({type:'custom_emoji',ownerUserId:12,needsRepainting:true}));
  assert.equal(f.calls[0].args.needs_repainting,true);assert.equal(f.calls[0].args.user_id,12);
  f.db.saveChat('b',{id:2,type:'private'});f.db.setRole('b',2,'user');
  const second=f.c.lifecycle.scope(f.db.ensureAgent('b',2));
  assert.deepEqual(await f.c.invoke(second,'sticker_sets',{}),{sets:[{name:'Faces_by_bot',title:'Faces',type:'custom_emoji',ownerUserId:12,link:'https://t.me/addemoji/Faces_by_bot'}]});
  f.db.registerBot({botId:'other',telegramId:43,username:'other_bot',ownerId:3});f.db.saveChat('other',{id:3,type:'private'});
  const other=f.c.lifecycle.scope(f.db.ensureAgent('other',3));
  assert.deepEqual(await f.c.invoke(other,'sticker_sets',{}),{sets:[]});
});

test('get accepts both Telegram links, returns complete native metadata and does not register external sets',async t=>{
  const f=fixture(t);
  for(const name of ['Faces_by_bot','https://t.me/addstickers/Faces_by_bot','https://t.me/addemoji/Faces_by_bot?x=1']){
    const r=await f.invoke('sticker_set_get',{name});assert.deepEqual(r.set.stickers,[member]);assert.equal(f.calls.at(-1).args.name,'Faces_by_bot');
  }
  assert.deepEqual(await f.invoke('sticker_sets'),{sets:[]});
});

test('all native edit operations select the correct endpoint and recorded owner',async t=>{
  const f=fixture(t);await f.invoke('sticker_set_create',createArgs({ownerUserId:12}));
  const cases=[
    [{action:'add',sticker:input},'addStickerToSet',{user_id:12,name:'Faces_by_bot',sticker:input}],
    [{action:'replace',oldFileId:'file-one',sticker:{...input,format:'animated'}},'replaceStickerInSet',{user_id:12,name:'Faces_by_bot',old_sticker:'file-one',sticker:{...input,format:'animated'}}],
    [{action:'remove',fileId:'file-one'},'deleteStickerFromSet',{sticker:'file-one'}],
    [{action:'move',fileId:'file-one',position:0},'setStickerPositionInSet',{sticker:'file-one',position:0}],
    [{action:'set_emojis',fileId:'file-one',emojiList:['👍']},'setStickerEmojiList',{sticker:'file-one',emoji_list:['👍']}],
    [{action:'set_keywords',fileId:'file-one',keywords:[]},'setStickerKeywords',{sticker:'file-one',keywords:[]}],
    [{action:'set_title',title:'New'},'setStickerSetTitle',{name:'Faces_by_bot',title:'New'}],
    [{action:'set_thumbnail',thumbnail:'thumb-id',format:'static'},'setStickerSetThumbnail',{name:'Faces_by_bot',user_id:12,thumbnail:'thumb-id',format:'static'}],
    [{action:'set_thumbnail',thumbnail:null,format:'animated',ownerUserId:15},'setStickerSetThumbnail',{name:'Faces_by_bot',user_id:15,format:'animated'}],
  ];
  for(const [fields,method,args] of cases){assert.deepEqual(await f.invoke('sticker_set_edit',{name:'Faces_by_bot',...fields}),{status:'done',name:'Faces_by_bot'});assert.equal(f.calls.at(-1).method,method);assert.deepEqual(f.calls.at(-1).args,args);}
  assert.equal((await f.invoke('sticker_sets')).sets[0].title,'New');
  assert.deepEqual(await f.invoke('sticker_set_delete',{name:'https://t.me/addstickers/Faces_by_bot'}),{status:'deleted',name:'Faces_by_bot'});
  assert.equal(f.calls.at(-1).method,'deleteStickerSet');assert.deepEqual(await f.invoke('sticker_sets'),{sets:[]});
});

test('emoji thumbnail uses custom ID and empty string for reset; other sets can be edited without registration',async t=>{
  const f=fixture(t);
  f.sets.set('faces_by_bot',{name:'Faces_by_bot',title:'Emoji',sticker_type:'custom_emoji',stickers:[{...member,custom_emoji_id:'9007199254740993123'}]});
  for(const [id,want] of [['9007199254740993123','9007199254740993123'],[null,'']]){
    const r=await f.invoke('sticker_set_edit',{name:'Faces_by_bot',action:'set_thumbnail',customEmojiId:id});assert.equal(r.status,'done');
    assert.equal(f.calls.at(-1).method,'setCustomEmojiStickerSetThumbnail');assert.deepEqual(f.calls.at(-1).args,{name:'Faces_by_bot',custom_emoji_id:want});
  }
  await f.invoke('sticker_set_edit',{name:'Faces_by_bot',action:'add',sticker:input,ownerUserId:99});assert.equal(f.calls.at(-1).args.user_id,99);
  assert.deepEqual(await f.invoke('sticker_sets'),{sets:[]});
});

test('malformed inputs, foreign members, attachments and paths cannot cause mutations',async t=>{
  const f=fixture(t);
  for(const args of [createArgs({name:'Bad__by_bot'}),createArgs({name:'Bad_by_other'}),createArgs({title:''}),createArgs({ownerUserId:-1}),createArgs({type:'mask'}),createArgs({stickers:[]}),createArgs({stickers:[{...input,format:'png'}]}),createArgs({stickers:[{...input,emoji_list:[]}]}),createArgs({needsRepainting:true}),createArgs({stickers:[{...input,sticker:'attach://missing'}]})]){
    assert.equal((await f.invoke('sticker_set_create',args)).error,'invalid_argument');
  }
  assert.equal((await f.invoke('sticker_set_create',createArgs({stickers:[{...input,sticker:'attach://bad'}],uploads:{bad:'../outside.png'}}))).error,'file_unavailable');
  for(const name of ['https://example.com/addemoji/Faces_by_bot','https://evil@t.me/addemoji/Faces_by_bot','https://t.me:444/addemoji/Faces_by_bot'])assert.equal((await f.invoke('sticker_set_get',{name})).error,'invalid_argument');
  for(const fields of [{action:'move',fileId:'foreign',position:0},{action:'remove',fileId:'foreign'},{action:'replace',oldFileId:'foreign',sticker:input},{action:'set_keywords',fileId:'file-one',keywords:['x'.repeat(65)]},{action:'move',fileId:'file-one',position:-1},{action:'set_thumbnail',thumbnail:'api',format:'wrong'},{action:'add',sticker:input,title:'unused'}]){
    assert.equal((await f.invoke('sticker_set_edit',{name:'Faces_by_bot',...fields})).error,'invalid_argument');
  }
  assert.equal(f.calls.filter(c=>c.method!=='getStickerSet').length,0);
});

test('uncertain create survives restart and is never retried or silently confirmed by a read',async t=>{
  const f=fixture(t,method=>{if(method==='createNewStickerSet')throw Object.assign(new Error('transport'),{code:'telegram_transport_failed'});});
  const r=await f.invoke('sticker_set_create',createArgs());assert.equal(r.error,'delivery_unknown');assert.equal(r.name,'Faces_by_bot');
  await f.invoke('sticker_set_get',{name:'Faces_by_bot'});
  const list=await f.invoke('sticker_sets');assert.equal(list.sets.length,0);assert.equal(list.uncertain[0].name,'Faces_by_bot');
  const second=openDatabase(f.file);try{assert.equal(second.sql.prepare('SELECT status FROM sticker_sets').get().status,'uncertain');}finally{second.close();}
  assert.equal((await f.invoke('sticker_set_create',createArgs({name:'faces_BY_BOT'}))).error,'delivery_unknown');
  assert.equal(f.calls.filter(c=>c.method==='createNewStickerSet').length,1);
});

test('Telegram rejection clears intent while storage failure after confirmation reports applied',async t=>{
  let reject=true;const f=fixture(t,method=>{if(method==='createNewStickerSet'&&reject)throw Object.assign(new Error('Bad Request: invalid sticker'),{code:'telegram_api_error'});});
  const r=await f.invoke('sticker_set_create',createArgs());assert.equal(r.error,'telegram_api_error');assert.match(r.description,/invalid sticker/);assert.deepEqual(await f.invoke('sticker_sets'),{sets:[]});
  reject=false;f.db.sql.exec("CREATE TRIGGER fail_confirm BEFORE UPDATE ON sticker_sets WHEN NEW.status='confirmed' BEGIN SELECT RAISE(ABORT,'disk'); END");
  const failed=await f.invoke('sticker_set_create',createArgs());assert.equal(failed.error,'storage_failed');assert.equal(failed.applied,true);assert.equal(failed.name,'Faces_by_bot');
});

test('failed deletion retains catalog; confirmed deletion storage failure cannot invite resend',async t=>{
  let fail=false;const f=fixture(t,method=>{if(method==='deleteStickerSet'&&fail)throw Object.assign(new Error('timeout'),{code:'telegram_transport_failed'});});
  await f.invoke('sticker_set_create',createArgs());fail=true;
  assert.equal((await f.invoke('sticker_set_delete',{name:'Faces_by_bot'})).error,'delivery_unknown');assert.equal((await f.invoke('sticker_sets')).sets.length,1);
  fail=false;f.db.sql.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON sticker_sets BEGIN SELECT RAISE(ABORT,'disk'); END");
  const r=await f.invoke('sticker_set_delete',{name:'Faces_by_bot'});assert.equal(r.error,'storage_failed');assert.equal(r.applied,true);
});

test('lifecycle revoked during set lookup prevents a following mutation',async t=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,async method=>{if(method==='getStickerSet'){await waiting;return {name:'Faces_by_bot',title:'Faces',sticker_type:'regular',stickers:[member]};}});
  const call=f.invoke('sticker_set_edit',{name:'Faces_by_bot',action:'remove',fileId:'file-one'});
  await new Promise(resolve=>setImmediate(resolve));f.c.lifecycle.invalidate(f.scope.agentId);release();
  await assert.rejects(call);assert.equal(f.calls.filter(c=>c.method==='deleteStickerFromSet').length,0);
});

test('dynamic schemas expose native InputSticker arrays and every edit action',()=>{
  for(const name of ['sticker_set_get','sticker_sets','sticker_set_create','sticker_set_edit','sticker_set_delete'])assert.ok(dynamicTools.find(t=>t.name===name),name);
  const create=dynamicTools.find(t=>t.name==='sticker_set_create').inputSchema;
  assert.equal(create.properties.stickers.items.properties.format.enum.includes('animated'),true);
  assert.deepEqual(create.required,['name','title','type','stickers']);
});
