import path from 'node:path';

const fail=(error,description,extra={})=>({...extra,error,description});
const invalid=description=>Object.assign(new Error(description),{code:'invalid_argument'});
const text=(v,min=1,max=Infinity)=>typeof v==='string'&&[...v].length>=min&&[...v].length<=max;
const positive=v=>Number.isSafeInteger(v)&&v>0;
const formats=new Set(['static','animated','video']);
const link=row=>`https://t.me/${row.type==='custom_emoji'?'addemoji':'addstickers'}/${row.name}`;
const fields={add:['sticker','ownerUserId','uploads'],replace:['oldFileId','sticker','ownerUserId','uploads'],remove:['fileId'],move:['fileId','position'],set_emojis:['fileId','emojiList'],set_keywords:['fileId','keywords'],set_title:['title'],set_thumbnail:['thumbnail','format','customEmojiId','ownerUserId','uploads']};

function setName(value) {
  if(typeof value!=='string')throw invalid('name must be a sticker set short name or Telegram set link.');
  let name=value;
  if(/^https?:/i.test(value)){
    let url;try{url=new URL(value);}catch{throw invalid('Invalid Telegram set link.');}
    const match=/^\/(?:addstickers|addemoji)\/([A-Za-z][A-Za-z0-9_]{0,63})\/?$/.exec(url.pathname);
    if(url.protocol!=='https:'||url.hostname!=='t.me'||url.port||url.username||url.password||!match)throw invalid('Use an HTTPS t.me/addstickers or t.me/addemoji link.');
    name=match[1];
  }
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||name.includes('__'))throw invalid('Invalid sticker set short name.');
  return name;
}
function stringList(value,min,max,total=Infinity){return Array.isArray(value)&&value.length>=min&&value.length<=max&&[...value].every(x=>typeof x==='string')&&value.reduce((n,x)=>n+[...x].length,0)<=total;}
function source(value,uploads){
  if(!text(value))throw invalid('Sticker media references must be non-empty strings.');
  if(/^https?:\/\/api\.telegram\.org\/(?:file\/)?bot/i.test(value))throw invalid('Secret-bearing Telegram URLs cannot be used.');
  if(value.startsWith('attach://')&&!Object.hasOwn(uploads??{},value.slice(9)))throw invalid('Each attach:// reference requires a declared upload.');
}
function inputSticker(value,uploads){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['sticker','format','emoji_list','keywords'].includes(k))||!formats.has(value.format)||!stringList(value.emoji_list,1,20)||value.emoji_list.some(x=>!x.length)||value.keywords!==undefined&&!stringList(value.keywords,0,20,64))throw invalid('Use InputSticker with sticker, format (static/animated/video), 1-20 emoji_list strings and optional keywords (0-20, total 64 characters).');
  source(value.sticker,uploads);
}

export function createStickerSets({db,telegram,filesFor,assertCurrent}) {
  const record=(botId,name)=>db.sql.prepare('SELECT * FROM sticker_sets WHERE botId=? AND name=?').get(botId,name);
  const remove=(botId,name)=>db.sql.prepare('DELETE FROM sticker_sets WHERE botId=? AND name=?').run(botId,name);
  const summary=row=>({name:row.name,title:row.title,type:row.type,ownerUserId:row.ownerUserId,link:link(row)});
  const apiError=(e,name)=>e.code==='telegram_api_error'?fail('telegram_api_error',String(e.message).slice(0,1000),{name}):fail('delivery_unknown','Telegram confirmation was not received. Inspect the named set before repeating the operation.',{name});
  const storageError=name=>fail('storage_failed','Telegram applied the operation, but updating the local catalog failed. Do not repeat the mutation.',{applied:true,name});
  const uploadFiles=(scope,local)=>{
    if(local===undefined)return [];
    if(!local||typeof local!=='object'||Array.isArray(local)||Object.entries(local).some(([name,file])=>!/^[-A-Za-z0-9_]+$/.test(name)||!text(file)))throw invalid('uploads must map attachment names to permitted local file paths.');
    try{return Object.entries(local).map(([name,file])=>({name,filename:path.basename(file),bytes:filesFor(scope).read(file)}));}
    catch{throw Object.assign(new Error('A local upload is unavailable or outside permitted paths.'),{code:'file_unavailable'});}
  };
  const call=async(scope,method,args,uploads=[])=>{assertCurrent(scope);return telegram.call(scope.botId,method,args,{uploads});};
  return async(scope,tool,args={})=>{
    assertCurrent(scope);
    if(tool==='sticker_sets'){
      const rows=db.sql.prepare('SELECT * FROM sticker_sets WHERE botId=? ORDER BY name COLLATE NOCASE').all(scope.botId);
      const uncertain=rows.filter(r=>r.status==='uncertain').map(summary);
      return {sets:rows.filter(r=>r.status==='confirmed').map(summary),...(uncertain.length?{uncertain}:{})};
    }
    let name,files=[];
    try{
      name=setName(args.name);
      if(tool==='sticker_set_get'){
        let set;try{set=await call(scope,'getStickerSet',{name});}catch(e){return apiError(e,name);}
        assertCurrent(scope);
        if(record(scope.botId,name)?.status==='confirmed'){
          try{db.sql.prepare('UPDATE sticker_sets SET title=?,type=? WHERE botId=? AND name=?').run(set.title,set.sticker_type,scope.botId,name);}
          catch{return fail('storage_failed','The live set was read, but refreshing the local catalog failed.',{name});}
        }
        return {set,link:link({name:set.name,type:set.sticker_type})};
      }
      const previous=record(scope.botId,name),owner=args.ownerUserId??previous?.ownerUserId??db.getBot(scope.botId).ownerId;
      if(args.ownerUserId!==undefined&&!positive(args.ownerUserId))throw invalid('ownerUserId must be a positive safe integer.');
      if(tool==='sticker_set_create'){
        if(Object.keys(args).some(k=>!['name','title','type','ownerUserId','stickers','uploads','needsRepainting'].includes(k)))throw invalid('Unsupported create argument.');
        const suffix='_by_'+db.getBot(scope.botId).username;
        if(!name.toLowerCase().endsWith(suffix.toLowerCase())||!text(args.title,1,64)||!['regular','custom_emoji'].includes(args.type)||!Array.isArray(args.stickers)||args.stickers.length<1||args.stickers.length>50||args.needsRepainting!==undefined&&(args.type!=='custom_emoji'||typeof args.needsRepainting!=='boolean'))throw invalid('Use a full name ending _by_<bot_username>, title of 1-64 characters, regular/custom_emoji type and 1-50 stickers; needsRepainting is custom emoji only.');
        for(const sticker of args.stickers)inputSticker(sticker,args.uploads);
        if(previous)return previous.status==='uncertain'?apiError({},name):fail('invalid_argument','This set name is already recorded. Read or edit it instead of creating again.',{name});
        files=uploadFiles(scope,args.uploads);assertCurrent(scope);
        try{db.sql.prepare("INSERT INTO sticker_sets VALUES(?,?,?,?,?,'uncertain')").run(scope.botId,name,args.title,args.type,owner);}
        catch{return fail('storage_failed','The creation intent could not be saved; no Telegram creation was attempted.',{name,applied:false});}
        try{await call(scope,'createNewStickerSet',{user_id:owner,name,title:args.title,sticker_type:args.type,stickers:args.stickers,...(args.needsRepainting===undefined?{}:{needs_repainting:args.needsRepainting})},files);}
        catch(e){if(e.code==='telegram_api_error')try{remove(scope.botId,name);}catch{return fail('storage_failed','Telegram rejected creation, but removing the local uncertain intent failed.',{name,applied:false});}return apiError(e,name);}
        try{db.sql.prepare("UPDATE sticker_sets SET status='confirmed' WHERE botId=? AND name=?").run(scope.botId,name);}catch{return storageError(name);}
        return {status:'created',name,ownerUserId:owner,link:link({name,type:args.type})};
      }
      let method,body;
      if(tool==='sticker_set_delete'){method='deleteStickerSet';body={name};}
      else if(tool==='sticker_set_edit'){
        const allowed=fields[args.action];
        if(!Object.hasOwn(fields,args.action)||!allowed||Object.keys(args).some(k=>!['name','action',...allowed].includes(k)))throw invalid('Specify one supported action and only its arguments.');
        if(['add','replace'].includes(args.action))inputSticker(args.sticker,args.uploads);
        if(args.action==='set_title'&&!text(args.title,1,64))throw invalid('title must contain 1-64 characters.');
        if(args.action==='move'&&(!Number.isSafeInteger(args.position)||args.position<0))throw invalid('position must be a non-negative integer.');
        if(args.action==='set_emojis'&&(!stringList(args.emojiList,1,20)||args.emojiList.some(x=>!x.length)))throw invalid('emojiList must contain 1-20 non-empty strings.');
        if(args.action==='set_keywords'&&!stringList(args.keywords,0,20,64))throw invalid('keywords must contain 0-20 strings totaling at most 64 characters.');
        const target=args.action==='replace'?args.oldFileId:['remove','move','set_emojis','set_keywords'].includes(args.action)?args.fileId:undefined;
        if(['replace','remove','move','set_emojis','set_keywords'].includes(args.action)&&!text(target))throw invalid('A non-empty member file ID is required.');
        let set;
        if(target!==undefined||args.action==='set_thumbnail'){
          try{set=await call(scope,'getStickerSet',{name});}catch(e){return apiError(e,name);}
          assertCurrent(scope);
          if(target!==undefined&&!set.stickers.some(s=>s.file_id===target))throw invalid('The file ID is not a member of the named sticker set.');
        }
        switch(args.action){
          case 'add':method='addStickerToSet';body={user_id:owner,name,sticker:args.sticker};break;
          case 'replace':method='replaceStickerInSet';body={user_id:owner,name,old_sticker:target,sticker:args.sticker};break;
          case 'remove':method='deleteStickerFromSet';body={sticker:target};break;
          case 'move':method='setStickerPositionInSet';body={sticker:target,position:args.position};break;
          case 'set_emojis':method='setStickerEmojiList';body={sticker:target,emoji_list:args.emojiList};break;
          case 'set_keywords':method='setStickerKeywords';body={sticker:target,keywords:args.keywords};break;
          case 'set_title':method='setStickerSetTitle';body={name,title:args.title};break;
          case 'set_thumbnail':
            if(set.sticker_type==='custom_emoji'){
              if(args.customEmojiId!==null&&(!text(args.customEmojiId)||!set.stickers.some(s=>s.custom_emoji_id===args.customEmojiId))||['thumbnail','format','ownerUserId','uploads'].some(k=>args[k]!==undefined))throw invalid('Use a customEmojiId from the named set, or null to reset an emoji thumbnail.');
              method='setCustomEmojiStickerSetThumbnail';body={name,custom_emoji_id:args.customEmojiId??''};
            }else{
              if(args.customEmojiId!==undefined||!formats.has(args.format)||args.thumbnail!==null&&!text(args.thumbnail))throw invalid('Regular thumbnails require thumbnail (file reference or null) and format.');
              if(args.thumbnail!==null)source(args.thumbnail,args.uploads);
              method='setStickerSetThumbnail';body={name,user_id:owner,...(args.thumbnail===null?{}:{thumbnail:args.thumbnail}),format:args.format};
            }
            break;
        }
        files=uploadFiles(scope,args.uploads);
      }else throw invalid('Unknown sticker tool.');
      // Metadata awaits must never authorize a later mutation after revocation.
      assertCurrent(scope);
      try{await call(scope,method,body,files);}catch(e){return apiError(e,name);}
      try{
        if(tool==='sticker_set_delete')remove(scope.botId,name);
        else if(args.action==='set_title')db.sql.prepare('UPDATE sticker_sets SET title=? WHERE botId=? AND name=?').run(args.title,scope.botId,name);
      }catch{return storageError(name);}
      return {status:tool==='sticker_set_delete'?'deleted':'done',name};
    }catch(e){if(['invalid_argument','file_unavailable'].includes(e.code))return fail(e.code,e.message);throw e;}
  };
}
