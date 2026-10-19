import {randomUUID} from 'node:crypto';
import {plainJSON} from '../widgets/contract.mjs';
import {prepareActionButtons} from '../inline/buttons.mjs';
import {validateInlineFiles,validateNativeInlineResult} from '../inline/results.mjs';
import {richInput} from '../messages/callbacks.mjs';
import {findFile} from '../files/download.mjs';
import {guestError} from './store.mjs';

const kinds=['text','rich_message','photo','video','animation','audio','voice','document','sticker','location','venue','contact'];
const captions=['caption','caption_entities','parse_mode','show_caption_above_media'];
const mediaMetadata=['title','description','thumbnail_url','thumbnail_width','thumbnail_height','mime_type','performer','duration','width','height','audio_duration','voice_duration','video_duration','video_width','video_height','photo_width','photo_height','gif_duration','gif_width','gif_height','mpeg4_duration','mpeg4_width','mpeg4_height'];
const fail=message=>{throw guestError('invalid_argument',message);};

export function prepareGuestResult(scope,input,{db,access,origin='agent'}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Use a guest message object.');
  if(!['agent','widget'].includes(origin))fail('Invalid internal guest content origin.');
  const authored=JSON.parse(plainJSON(input)),present=kinds.filter(kind=>authored[kind]!==undefined);
  if(authored.reply_markup&&['keyboard','remove_keyboard'].some(key=>Object.hasOwn(authored.reply_markup,key)))fail('Guest output supports inline keyboards, not ordinary reply keyboards.');
  if(present.length!==1)fail('Specify exactly one supported guest message content field.');
  const kind=present[0],base=['file_sources','buttons','reply_markup','permits',kind];
  const allowed=new Set([...base,...(kind==='text'?['entities','parse_mode','link_preview_options']:kind==='rich_message'?[]:['location','venue','contact'].includes(kind)?[]:[...captions,...mediaMetadata])]);
  for(const key of Object.keys(authored))if(!allowed.has(key))fail('Unsupported guest field: '+key);
  if(authored.rich_message!==undefined)authored.rich_message=richInput(authored.rich_message);
  const sources=authored.file_sources??[];if(!Array.isArray(sources))fail('file_sources must be an array.');delete authored.file_sources;
  const prepared=origin==='widget'?{native:authored,definitions:[]}:prepareActionButtons(authored,{tipId:randomUUID().replaceAll('-','')});
  const {reply_markup,...body}=prepared.native,id=randomUUID().replaceAll('-','');
  let native;
  if(kind==='text'||kind==='rich_message'){
    const content=kind==='text'?{...body,message_text:body.text}:body;
    delete content.text;native={type:'article',id,title:'Response',input_message_content:content};
  }else if(['location','venue','contact'].includes(kind)){
    if(!body[kind]||typeof body[kind]!=='object'||Array.isArray(body[kind]))fail(kind+' must contain its native fields.');
    native={...body[kind],type:kind,id};if(kind==='location')native.title??='Location';
  }else{
    const media=body[kind];if(typeof media!=='string'||!media)fail('Guest media must be a file ID or supported public URL.');
    const url=/^https?:\/\//i.test(media);
    let type=kind;
    if(kind==='animation'){
      const source=sources.find(s=>s?.fileId===media),outer=source&&db?.getMessage(scope.botId,source.chatId??scope.chatId,source.messageId);
      const mime=body.mime_type??findFile(outer,media)?.mime_type;
      if(url&&!['image/gif','video/mp4'].includes(mime))fail('URL animation needs mime_type image/gif or video/mp4 and thumbnail_url.');
      type=mime==='video/mp4'?'mpeg4_gif':'gif';
    }
    if(kind==='sticker'&&url)fail('Guest stickers require an existing sticker file ID.');
    const prefix=type==='mpeg4_gif'?'mpeg4':type;
    native={type,id,[`${prefix}_${url?'url':'file_id'}`]:media};
    for(const key of [...captions,...mediaMetadata])if(body[key]!==undefined&&!['mime_type','duration','width','height'].includes(key))native[key]=body[key];
    if(body.duration!==undefined)native[`${prefix}_duration`]=body.duration;
    if(body.width!==undefined)native[`${prefix}_width`]=body.width;
    if(body.height!==undefined)native[`${prefix}_height`]=body.height;
    if(['video','audio','voice','document'].includes(kind))native.title??=kind[0].toUpperCase()+kind.slice(1);
    if(url&&kind==='photo')native.thumbnail_url??=media;
    if(url&&['video','document'].includes(kind))native.mime_type=body.mime_type??(kind==='video'?'video/mp4':undefined);
  }
  if(reply_markup!==undefined)native.reply_markup=reply_markup;
  validateInlineFiles(scope,native,sources,{db,access,allowUnprovenFileIds:origin==='widget'});
  validateNativeInlineResult(native);
  const snapshot={...prepared.native,reply_markup:reply_markup??{inline_keyboard:[]}};
  return {native,definitions:prepared.definitions,snapshot};
}
