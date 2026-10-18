// Public fixtures and synthetic media only; called by the bounded native acceptance runner.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeInlineResults} from '../../src/inline/results.mjs';
import {createAccess} from '../../src/access/scope.mjs';

export const matrixSources=Object.freeze({
  photo:'https://mdn.github.io/shared-assets/images/examples/grapefruit-slice.jpg',
  gif:'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif',
  video:'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  mpeg4:'https://raw.githubusercontent.com/chromium/chromium/main/media/test/data/bear_silent.mp4',
  audio:'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
  voice:'https://raw.githubusercontent.com/chromium/chromium/main/media/test/data/bear-opus.ogg',
  document:'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
});

export async function prepareMediaMatrix({controller,db,scope,workspace,assetsDir,signal}){
  if(!assetsDir||!fs.existsSync(path.join(assetsDir,'sticker.webp')))throw new Error('Matrix requires an explicit synthetic sticker asset.');
  const base=path.join('.temp',scope.agentId,'inline-media-matrix');fs.mkdirSync(path.join(workspace,base),{recursive:true});
  const files={photo:'photo.jpg',gif:'animation.gif',video:'flower.mp4',mpeg4:'silent.mp4',audio:'audio.mp3',voice:'voice.ogg',document:'document.pdf',sticker:'sticker.webp'};
  await Promise.all(Object.entries(matrixSources).map(async([kind,url])=>{
    const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
    if(!response.ok)throw new Error('Public matrix fixture unavailable: '+kind);
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>5*1024*1024)throw new Error('Public matrix fixture exceeds budget.');
    fs.writeFileSync(path.join(workspace,base,files[kind]),bytes);
  }));
  fs.copyFileSync(path.join(assetsDir,'sticker.webp'),path.join(workspace,base,files.sticker));
  // Distinct animation content separates URL/cached compatibility from duplicate-media filtering.
  if(fs.existsSync(path.join(assetsDir,'mpeg4.mp4')))fs.copyFileSync(path.join(assetsDir,'mpeg4.mp4'),path.join(workspace,base,files.mpeg4));
  if(fs.existsSync(path.join(assetsDir,'photo.jpg')))fs.copyFileSync(path.join(assetsDir,'photo.jpg'),path.join(workspace,base,files.photo));
  const checkpoint=path.join(workspace,base,'buffers.json');
  const buffers=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')):{};
  const saved={};
  for(const [kind,method,source,nativeKey] of [
    ['photo','photo','photo','photo'],['gif','animation','gif','animation'],['mpeg4_gif','animation','mpeg4','animation'],
    ['video','video','video','video'],['audio','audio','audio','audio'],
    ['document','document','document','document'],['sticker','sticker','sticker','sticker'],['voice','voice','voice','voice'],
  ]){
    const sha256=createHash('sha256').update(fs.readFileSync(path.join(workspace,base,files[source]))).digest('hex');
    const previous=buffers[kind],old=previous&&db.getMessage(scope.botId,scope.chatId,previous.messageId),oldMedia=old?.[nativeKey];
    if(previous?.sha256===sha256&&(Array.isArray(oldMedia)?oldMedia.at(-1)?.file_id:oldMedia?.file_id)===previous.fileId&&(kind!=='audio'||oldMedia.title?.trim())){saved[kind]={messageId:previous.messageId,fileId:previous.fileId};continue;}
    const result=await controller.invoke(scope,'send',{[method]:'attach://fixture',uploads:{fixture:path.join(base,files[source])},disable_notification:true,...(kind==='audio'?{title:'Audio cached',performer:'Inline fixture'}:{}),...(kind==='sticker'?{}:{caption:'Inline matrix buffer: '+kind})});
    if(result.error)throw Object.assign(new Error('Matrix '+kind+' buffer: '+result.description),{code:result.error});
    const messageId=result.messageIds[0],message=db.getMessage(scope.botId,scope.chatId,messageId),media=message[nativeKey];
    const fileId=Array.isArray(media)?media.at(-1).file_id:media?.file_id;
    if(!fileId)throw new Error('Missing cached matrix media: '+kind);saved[kind]={messageId,fileId};
    buffers[kind]={...saved[kind],sha256};fs.writeFileSync(checkpoint,JSON.stringify(buffers));
  }
  const url=(kind,fields)=>({native:{type:kind,id:kind+'-url',...fields}});
  const cached=(kind,fields={})=>({native:{type:kind,id:kind+'-cached',[kind==='mpeg4_gif'?'mpeg4_file_id':kind+'_file_id']:saved[kind].fileId,...fields},file_sources:[saved[kind]]});
  const thumb=matrixSources.photo;
  const results={
    text:[{native:{type:'article',id:'article-native',title:'Native article',input_message_content:{message_text:'Native inline article fixture'}}}],
    photo:[url('photo',{photo_url:matrixSources.photo,thumbnail_url:thumb,title:'Photo URL',caption:'Photo URL'}),cached('photo',{title:'Photo cached',caption:'Photo cached'})],
    gif:[url('gif',{gif_url:matrixSources.gif,thumbnail_url:thumb,title:'GIF URL',caption:'GIF URL'}),cached('gif',{title:'GIF cached',caption:'GIF cached'})],
    mpeg4:[url('mpeg4_gif',{mpeg4_url:matrixSources.mpeg4,thumbnail_url:thumb,title:'MPEG4 URL',caption:'MPEG4 URL'}),cached('mpeg4_gif',{title:'MPEG4 cached',caption:'MPEG4 cached'})],
    video:[url('video',{video_url:matrixSources.video,mime_type:'video/mp4',thumbnail_url:thumb,title:'Video URL',caption:'Video URL'}),cached('video',{title:'Video cached',caption:'Video cached'})],
    audio:[url('audio',{audio_url:matrixSources.audio,title:'Audio URL',caption:'Audio URL'}),cached('audio',{title:'Audio cached',caption:'Audio cached'})],
    voice:[url('voice',{voice_url:matrixSources.voice,title:'Voice URL',caption:'Voice URL'}),cached('voice',{title:'Voice cached',caption:'Voice cached'})],
    document:[url('document',{document_url:matrixSources.document,mime_type:'application/pdf',title:'Document URL',caption:'Document URL'}),cached('document',{title:'Document cached',caption:'Document cached'})],
    sticker:[cached('sticker')],
    places:[{native:{type:'location',id:'location-native',latitude:0,longitude:0,title:'Test location'}},{native:{type:'venue',id:'venue-native',latitude:0,longitude:0,title:'Test venue',address:'Synthetic test venue'}},{native:{type:'contact',id:'contact-native',phone_number:'+12025550123',first_name:'Inline',last_name:'Test contact'}}],
  };
  // Exercise the actual normalizer/provenance checks before opening the poller.
  normalizeInlineResults(scope,Object.values(results).flat(),{db,access:createAccess(db)});
  return {results,sources:saved};
}
