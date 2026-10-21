const roles = new Set(['photo','video','animation','audio','document','voice','voice_note','sticker','video_note','cover','thumbnail']);
const invalid = message => Object.assign(new Error(message), {code:'invalid_argument'});
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// Only visit native file positions. Text, markup, buttons and arbitrary metadata
// remain opaque even when they contain keys or strings resembling media sources.
export function mapMediaSources(value, mapper, {kind='message'}={}) {
  function reference(node,key,p,role=key,responsePath=[...p,key]) {
    if(node[key]===undefined)return;
    const at=[...p,key];
    if(typeof node[key]!=='string'||!node[key])throw invalid(`${at.join('.')} must be a non-empty string file_id, HTTP(S) URL or file:path.`);
    node[key]=mapper(node[key],at,role,responsePath);
  }
  function media(node,p,responsePath=p) {
    if(!object(node)||typeof node.type!=='string'||!roles.has(node.type)&&node.type!=='live_photo')throw invalid(`${p.join('.')} must be a native InputMedia object.`);
    if(node.media===undefined)throw invalid(`${[...p,'media'].join('.')} is required.`);
    reference(node,'media',p,node.type,responsePath);
    if(node.type==='live_photo')reference(node,'photo',p,'photo');
    reference(node,'thumbnail',p);reference(node,'cover',p);
  }
  function blocks(items,p) {
    if(!Array.isArray(items))return;
    for(const [i,block] of items.entries()) {
      if(!object(block))continue;
      const q=[...p,i],role=block.type;
      if(roles.has(role)&&block[role]!==undefined)media(block[role],[...q,role]);
      if(['details','blockquote','collage','slideshow'].includes(role))blocks(block.blocks,[...q,'blocks']);
      if(role==='list'&&Array.isArray(block.items))for(const [j,item]of block.items.entries())blocks(item?.blocks,[...q,'items',j,'blocks']);
    }
  }
  if(kind==='stickerSet') {
    if(Array.isArray(value.stickers))for(const [i,sticker]of value.stickers.entries())if(object(sticker))reference(sticker,'sticker',['stickers',i]);
    if(object(value.sticker))reference(value.sticker,'sticker',['sticker']);
    if(value.thumbnail!==null)reference(value,'thumbnail',[]);
    return value;
  }
  for(const role of roles)reference(value,role,[],role,role==='cover'?['video','cover']:[role]);
  if(value.live_photo!==undefined) {
    if(!object(value.live_photo))throw invalid('live_photo must be an object.');
    reference(value.live_photo,'media',['live_photo'],'live_photo',['live_photo']);
    reference(value.live_photo,'photo',['live_photo'],'photo');
  }
  if(value.media!==undefined) {
    if(Array.isArray(value.media))for(const [i,item]of value.media.entries())media(item,['media',i]);
    else media(value.media,['media']);
  }
  const rich=value.rich_message;
  if(object(rich)) {
    blocks(rich.blocks,['rich_message','blocks']);
    if(Array.isArray(rich.media))for(const [i,binding]of rich.media.entries())media(binding?.media,['rich_message','media',i,'media']);
  }
  if(object(value.poll)) {
    if(value.poll.media!==undefined)media(value.poll.media,['poll','media'],['poll','media',value.poll.media?.type]);
    if(Array.isArray(value.poll.options))for(const [i,option]of value.poll.options.entries())if(option?.media!==undefined)media(option.media,['poll','options',i,'media'],['poll','options',i,'media',option.media?.type]);
  }
  return value;
}

export function prepareLocalMedia(input, local, options) {
  const value=structuredClone(input);
  if(local!==undefined&&(!object(local)||Object.values(local).some(p=>typeof p!=='string'||!p)))throw invalid('Legacy uploads must map attachment names to local paths. Use file:path in media fields.');
  let declarations=local===undefined?undefined:{...local},count=0;
  const reserved=new Set(Object.keys(value));
  mapMediaSources(value,source=>{if(source.startsWith('attach://'))reserved.add(source.slice(9));return source;},options);
  mapMediaSources(value,(source,p)=>{
    if(!source.startsWith('file:'))return source;
    const file=source.slice(5);
    if(!file)throw invalid(`${p.join('.')} requires a path after file:.`);
    declarations??={};
    let name;do{name='local_media_'+count++;}while(Object.hasOwn(declarations,name)||reserved.has(name));
    declarations[name]=file;
    return 'attach://'+name;
  },options);
  return {value,local:declarations};
}
