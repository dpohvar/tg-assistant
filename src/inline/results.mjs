import {randomUUID} from 'node:crypto';
import {plainJSON} from '../widgets/contract.mjs';
import {inlineError} from './contract.mjs';
import {prepareActionButtons} from './buttons.mjs';
const caption=['caption','parse_mode','caption_entities'],above=[...caption,'show_caption_above_media'],thumb=['thumbnail_url','thumbnail_width','thumbnail_height'];
const shape=(required,optional=[])=>({required,allowed:[...required,...optional]});
const formats={
 article:shape(['title','input_message_content'],['url','description',...thumb]),
 photo:shape(['photo_url','thumbnail_url'],['photo_width','photo_height','title','description',...above]),
 gif:shape(['gif_url','thumbnail_url'],['gif_width','gif_height','gif_duration','thumbnail_mime_type','title',...above]),
 mpeg4_gif:shape(['mpeg4_url','thumbnail_url'],['mpeg4_width','mpeg4_height','mpeg4_duration','thumbnail_mime_type','title',...above]),
 video:shape(['video_url','mime_type','thumbnail_url','title'],['video_width','video_height','video_duration','description',...above]),
 audio:shape(['audio_url','title'],['performer','audio_duration',...caption]),
 voice:shape(['voice_url','title'],['voice_duration',...caption]),
 document:shape(['title','document_url','mime_type'],['description',...thumb,...caption]),
 location:shape(['latitude','longitude','title'],['horizontal_accuracy','live_period','heading','proximity_alert_radius',...thumb]),
 venue:shape(['latitude','longitude','title','address'],['foursquare_id','foursquare_type','google_place_id','google_place_type',...thumb]),
 contact:shape(['phone_number','first_name'],['last_name','vcard',...thumb]),
};
const cached={photo:shape(['photo_file_id'],['title','description',...above]),gif:shape(['gif_file_id'],['title',...above]),mpeg4_gif:shape(['mpeg4_file_id'],['title',...above]),sticker:shape(['sticker_file_id']),document:shape(['document_file_id','title'],['description',...caption]),video:shape(['video_file_id','title'],['description',...above]),voice:shape(['voice_file_id','title'],caption),audio:shape(['audio_file_id'],['title','performer','audio_duration',...caption])};
const fail=message=>{throw inlineError('invalid_argument',message);};
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('Use a JSON object.');}
function fields(value,format,extra=[]) {
  object(value);for(const field of Object.keys(value))if(!format.allowed.includes(field)&&!extra.includes(field))fail('Unsupported inline field: '+field);
  for(const field of format.required)if(value[field]===undefined||value[field]===null||value[field]==='')fail('Required inline field: '+field);
  for(const [field,item]of Object.entries(value)) {
    if(['type','id',...extra].includes(field))continue;
    if(['entities','caption_entities'].includes(field)){if(!Array.isArray(item))fail(field+' must be an array.');continue;}
    if(field==='rich_message'&&typeof item==='string')continue;
    if(['rich_message','reply_markup','input_message_content','link_preview_options'].includes(field)){object(item);continue;}
    if(field==='show_caption_above_media'){if(typeof item!=='boolean')fail(field+' must be boolean.');continue;}
    if(['latitude','longitude','horizontal_accuracy'].includes(field)||/(?:_width|_height|_duration)$/.test(field)||['live_period','heading','proximity_alert_radius'].includes(field)){
      if(typeof item!=='number'||!Number.isFinite(item)||!['latitude','longitude'].includes(field)&&item<0)fail(field+' must be a valid number.');
      if(field==='latitude'&&Math.abs(item)>90||field==='longitude'&&Math.abs(item)>180)fail('Invalid location coordinates.');continue;
    }
    if(typeof item!=='string')fail(field+' must be a string.');
  }
}
function inputContent(content) {
  object(content);let format;
  if(content.message_text!==undefined)format=shape(['message_text'],['parse_mode','entities','link_preview_options']);
  else if(content.rich_message!==undefined)format=shape(['rich_message']);
  else if(content.phone_number!==undefined)format=shape(['phone_number','first_name'],['last_name','vcard']);
  else if(content.latitude!==undefined)format=content.address!==undefined?shape(['latitude','longitude','title','address'],['foursquare_id','foursquare_type','google_place_id','google_place_type']):shape(['latitude','longitude'],['horizontal_accuracy','live_period','heading','proximity_alert_radius']);
  else fail('Unsupported InputMessageContent; invoices are not supported.');
  fields(content,format);
  if(content.message_text!==undefined&&content.message_text.length>4096)fail('Inline message text exceeds 4096 UTF-16 units.');
  if(content.parse_mode!==undefined&&content.entities!==undefined)fail('Use entities or parse_mode.');
}
function filePresent(value,id) {
  if(!value||typeof value!=='object')return false;
  if(value.file_id===id)return true;
  return Object.values(value).some(child=>filePresent(child,id));
}
export function validateInlineFiles(scope,value,fileSources=[],{db,access,allowUnprovenFileIds=false}={}) {
  if(!Array.isArray(fileSources))fail('file_sources must be an array.');
  const proof=id=>fileSources.some(source=>{
    if(!source||source.fileId!==id||!Number.isSafeInteger(source.messageId))return false;
    const chatId=source.chatId??scope.chatId;
    try {access.assertRead(scope,chatId);return filePresent(db.getMessage(scope.botId,chatId,source.messageId),id);}catch{return false;}
  });
  function media(source,{rich=false}={}) {
    if(typeof source!=='string')return;
    if(/^(?:attach:\/\/|file:|[a-zA-Z]:[\\/]|\/|\\|\.\.?[\\/])/.test(source))throw inlineError('inline_upload_forbidden','Inline output cannot upload files. Send the file to an authorized buffer chat first, then use its file_id and file_sources.');
    if(/^https?:\/\//i.test(source)) {
      const url=new URL(source);if(url.hostname.toLowerCase()==='api.telegram.org'&&/^\/(?:file\/)?bot/i.test(url.pathname))throw inlineError('file_not_accessible','Secret-bearing Telegram URLs are forbidden.');
      if(rich)throw inlineError('file_not_accessible','Inline rich media require previously uploaded Telegram file IDs.');return;
    }
    if(!allowUnprovenFileIds&&!proof(source))throw inlineError('file_not_accessible','A saved, readable outer message in file_sources must prove every Telegram file_id.');
  }
  const mediaKeys=new Set(['photo','video','animation','audio','voice','voice_note','document','sticker','video_note','cover','thumbnail']);
  function visit(node,rich=false) {
    if(!node||typeof node!=='object')return;
    for(const [key,item]of Object.entries(node)) {
      if(key==='permits')continue;
      if(key==='uploads'||key==='upload')throw inlineError('inline_upload_forbidden','Inline output cannot upload files.');
      if(['pay','callback_game','game_short_name','provider_token','currency','prices'].includes(key))fail('Games and invoices are not supported.');
      const inRich=rich||key==='rich_message';
      if(typeof item==='string'&&key==='url'&&/^tg:\/\//i.test(item))continue;
      if(typeof item==='string'&&(key.endsWith('_file_id')||key==='media'||mediaKeys.has(key)||key.endsWith('_url')||key==='url'))media(item,{rich:inRich&&key!=='url'});
      else if(item&&typeof item==='object')visit(item,inRich);
    }
  }
  visit(value);
}
export function validateNativeInlineResult(native) {
  object(native);
  if(typeof native.id!=='string'||!native.id||Buffer.byteLength(native.id)>64)fail('Result IDs must contain 1–64 UTF-8 bytes.');
  const isCached=Object.keys(native).some(key=>key.endsWith('_file_id')),format=isCached?cached[native.type]:formats[native.type];
  if(!format)fail('Unsupported inline result type.');
  fields(native,format,['type','id','reply_markup',...(native.type==='article'?[]:['input_message_content'])]);
  if(native.input_message_content)inputContent(native.input_message_content);
  if(native.parse_mode!==undefined&&native.caption_entities!==undefined)fail('Use caption_entities or parse_mode.');
  if(!isCached&&native.type==='document'&&!['application/pdf','application/zip'].includes(native.mime_type))fail('URL documents require PDF or ZIP MIME type.');
  if(!isCached&&native.type==='video'&&!['text/html','video/mp4'].includes(native.mime_type))fail('URL video requires text/html or video/mp4.');
  if(native.mime_type==='text/html'&&native.type==='video'&&!native.input_message_content)fail('HTML video requires input_message_content.');
}
export function normalizeInlineResults(scope,results,adapters={}) {
  if(!Array.isArray(results))fail('results must be an array.');
  const ids=adapters.ids??(()=>randomUUID().replaceAll('-','')),used=new Set();
  const prepared=results.map(original=>{
    object(original);const item=JSON.parse(plainJSON(original));
    validateInlineFiles(scope,item,item.file_sources??item.message?.file_sources??[],adapters);
    let native,definitions=[];
    const tipId=ids();
    if(item.native!==undefined) {
      if(Object.keys(item).some(key=>!['native','file_sources'].includes(key)))fail('A native result cannot also have friendly fields.');
      native=item.native;object(native);
      if(native.input_message_content) {
        const prepared=prepareActionButtons(native.input_message_content,{tipId,ids});native.input_message_content=prepared.native;definitions.push(...prepared.definitions);inputContent(native.input_message_content);
      }
      const keyboard=prepareActionButtons({...(native.reply_markup!==undefined?{reply_markup:native.reply_markup}:{})},{tipId,ids});
      if(keyboard.native.reply_markup!==undefined)native.reply_markup=keyboard.native.reply_markup;definitions.push(...keyboard.definitions);
    } else {
      if(Object.keys(item).some(key=>!['id','title','description','url',...thumb,'message','file_sources'].includes(key)))fail('Unknown friendly inline result field.');
      const message=item.message??{text:'✖️'};object(message);
      const {file_sources, ...authored}=message,prepared=prepareActionButtons(authored,{tipId,ids});definitions=prepared.definitions;
      const {reply_markup,...body}=prepared.native;
      if(body.text!==undefined){body.message_text=body.text;delete body.text;}
      inputContent(body);
      const {message:_,file_sources:__,...metadata}=item;native={type:'article',...metadata,input_message_content:body,...(reply_markup?{reply_markup}:{})};
    }
    native.id??=ids();
    if(typeof native.id!=='string'||!native.id.length||Buffer.byteLength(native.id)>64||used.has(native.id))fail('Result IDs must be unique and contain 1–64 UTF-8 bytes.');used.add(native.id);
    validateNativeInlineResult(native);
    return {native,definitions};
  });
  return [...prepared.filter(item=>item.native.type!=='photo'),...prepared.filter(item=>item.native.type==='photo')];
}
