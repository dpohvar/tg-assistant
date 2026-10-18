// Bounded raw client-compatibility control. Uses confirmed fixture buffers, no model or sends.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createTelegram} from '../../src/telegram/api.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {normalizeInlineResults} from '../../src/inline/results.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {prepareMediaMatrix,matrixSources} from './inline-media-matrix.mjs';

export function mixedMediaItems(results){
  const items=Object.values(results).flat().map(item=>structuredClone(item));
  items.splice(1,0,{native:{type:'article',id:'all-rich',title:'Rich article',input_message_content:{rich_message:{blocks:[{type:'paragraph',text:'Inline mixed rich fixture'}]}}}});
  return items.map((item,index)=>{
    const n='['+String(index+1).padStart(2,'0')+'] ',native=item.native;
    if(native.title)native.title=n+native.title;
    if(native.caption)native.caption=n+native.caption;
    if(native.type==='contact')native.first_name=n+native.first_name;
    return item;
  });
}

export function thumbnailProbePages(photos,thumbnailUrl,{thumbnails=true}={}){
  const article=(id,title,thumb=false)=>({native:{type:'article',id,title,input_message_content:{message_text:'✖️'},...(thumb?{thumbnail_url:thumbnailUrl,thumbnail_width:64,thumbnail_height:64}:{})}});
  const photo=(index,page)=>{const item=structuredClone(photos[index]);item.native.id='layout-photo-'+page;item.native.caption='Layout photo page '+page;return item;};
  return [
    Array.from({length:10},(_,i)=>article('layout-first-'+i,`⬇️ [1:${i+1}] Article with thumbnail`,thumbnails)),
    [photo(0,2),article('layout-second-article','⬇️ [2:2] Plain article')],
    [article('layout-third-first','[3:1] Plain article'),photo(1,3),article('layout-third-last','[3:3] Plain article')],
  ];
}

export function avatarProbePages(photos,header){
  const article=(id,title)=>({native:{type:'article',id,title,input_message_content:{message_text:'✖️'}}});
  const photo=(index)=>{const item=structuredClone(photos[index]);item.native.id='avatar-final-photo-'+index;return item;};
  const first=Array.from({length:6},(_,i)=>article('avatar-first-'+i,`⬇️ [1:${i+1}] Scroll to send command`));
  if(header)first[0]={native:{...structuredClone(header),id:'avatar-header',title:'⬇️ [1:1] Scroll to send command',input_message_content:{message_text:'✖️'}}};
  return [first,Array.from({length:6},(_,i)=>article('avatar-second-'+i,`⬇️ [2:${i+1}] Scroll to send command`)),
    [article('avatar-final-first','[3:1] Plain article'),photo(0),article('avatar-final-middle','[3:3] Plain article'),photo(1),article('avatar-final-last','[3:5] Plain article')]];
}

export function createLayoutPager(pages,ownerId){
  let session;
  return {receive(q){
    const empty={results:[],next_offset:'',page:0};if(q.from.id!==ownerId)return empty;
    let index;
    if(!q.offset){session={id:randomUUID().replaceAll('-',''),query:q.query,cursors:new Map()};index=0;}
    else {if(!session||session.query!==q.query)return empty;index=session.cursors.get(q.offset);if(index===undefined)return empty;}
    const next=index+1<pages.length?session.id+':'+(index+1):'';if(next)session.cursors.set(next,index+1);
    return {results:pages[index],next_offset:next,page:index+1};
  }};
}

export async function runMixedMediaProbe({argv=process.argv.slice(2),signal,log=e=>console.log(JSON.stringify({at:Date.now(),...e}))}={}){
  const {values}=parseArgs({args:argv,options:{config:{type:'string'},'state-dir':{type:'string'},case:{type:'string',default:'all'},'no-thumbnails':{type:'boolean',default:false},'duration-seconds':{type:'string',default:'1800'}}});
  if(!values.config||!values['state-dir'])throw new Error('Explicit config and existing fixture state-dir are required.');
  if(!['all','layout','avatar'].includes(values.case))throw new Error('Invalid raw media probe case.');
  if(values['no-thumbnails']&&values.case!=='layout')throw new Error('No-thumbnails control requires the layout case.');
  const duration=Number(values['duration-seconds']);if(!Number.isSafeInteger(duration)||duration<1||duration>1800)throw new Error('Invalid duration.');
  const file=path.resolve(values.config),config=JSON.parse(fs.readFileSync(file,'utf8')),root=path.resolve(values['state-dir']);
  if(!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||config.controllerActive)throw new Error('Invalid designated fixture identity.');
  const release=acquireLock(path.join(path.dirname(file),'inline-calibration.lock'));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000),stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const token=config.token??fs.readFileSync(config.tokenFile,'utf8').trim(),telegram=createTelegram({getToken:()=>token}),botId='inline-acceptance';let db;
  try{
    const me=await telegram.call(botId,'getMe');if(me.id!==config.botTelegramId||!me.supports_inline_queries)throw new Error('Designated bot identity mismatch.');
    if((await telegram.call(botId,'getWebhookInfo')).url)throw new Error('Fixture webhook is active.');
    db=openDatabase(path.join(root,'data/controller.sqlite'));
    const bot=db.getBot(botId),owner=db.agent(botId,config.ownerId);
    if(!bot||bot.telegramId!==me.id||bot.ownerId!==config.ownerId||!owner)throw new Error('Existing fixture ownership mismatch.');
    const scope={...owner,botId,chatId:config.ownerId};
    const matrix=await prepareMediaMatrix({controller:{invoke:async()=>{throw new Error('A confirmed buffer is missing; raw probe never sends new files.');}},db,scope,workspace:path.join(root,'bots',botId),assetsDir:config.mediaAssets,signal:abort.signal});
    let itemPages,avatarHeader,headerSource;
    if(values.case==='layout'||values.case==='avatar'){
      const current=db.getMessage(botId,config.ownerId,matrix.sources.photo.messageId).photo.at(-1);
      const other=db.sql.prepare('SELECT json FROM messages WHERE botId=? AND chatId=? AND json_extract(json,\'$.caption\')=? ORDER BY messageId DESC').all(botId,config.ownerId,'Inline matrix buffer: photo').map(row=>JSON.parse(row.json)).find(m=>m.photo?.at(-1)?.file_unique_id!==current.file_unique_id&&m.photo?.length);
      if(!other)throw new Error('A second distinct confirmed matrix photo is required.');
      const fileId=other.photo.at(-1).file_id,alternate={native:{type:'photo',photo_file_id:fileId},file_sources:[{messageId:other.message_id,fileId}]};
      if(values.case==='avatar'){
        const profile=await telegram.call(botId,'getUserProfilePhotos',{user_id:me.id,limit:1},{signal:abort.signal});
        const ownPhoto=profile.photos?.[0]?.at(-1)?.file_id;
        // Throwaway layout control: existing child-bot buffer simulates a preset fallback, not master configuration.
        avatarHeader={type:'photo',photo_file_id:ownPhoto??current.file_id};headerSource=ownPhoto?'bot_avatar':'confirmed_fixture_fallback';
        itemPages=avatarProbePages([matrix.results.photo[1],alternate],avatarHeader);
      }else itemPages=thumbnailProbePages([matrix.results.photo[1],alternate],matrixSources.photo,{thumbnails:!values['no-thumbnails']});
    }else itemPages=[mixedMediaItems(matrix.results)];
    // Validate every item through production provenance checks while preserving the raw mixed order.
    // The system header comes only from the own-profile API or the already verified fixture buffer.
    const pages=itemPages.map(items=>items.map(item=>values.case==='avatar'&&item.native.id==='avatar-header'?item.native:normalizeInlineResults(scope,[item],{db,access:createAccess(db)})[0].native));
    if(values.case==='all'&&pages[0].length!==20)throw new Error('Expected all 19 native variants plus rich article.');
    const pager=values.case!=='all'?createLayoutPager(pages,config.ownerId):null;
    db.close();db=undefined;
    for(const result of pages.flat())await telegram.call(botId,'savePreparedInlineMessage',{user_id:config.ownerId,allow_user_chats:true,result},{signal:abort.signal});
    const backlog=await telegram.call(botId,'getUpdates',{offset:-1,timeout:0},{signal:abort.signal});let offset=backlog.at(-1)?.update_id+1;if(!Number.isSafeInteger(offset))offset=undefined;
    log({type:'ready',case:values.case,headerSource,firstPageThumbnails:pages[0].filter(r=>r.thumbnail_url).length,botUsername:me.username,pageSizes:pages.map(p=>p.length),kinds:pages.map(p=>p.map(r=>r.type)),rawMixed:true,durationSeconds:duration});
    const seen=new Set();let answers=0;
    while(!abort.signal.aborted&&!fs.existsSync(path.join(root,'stop-media-all'))){
      const updates=await telegram.call(botId,'getUpdates',{offset,timeout:15,allowed_updates:['inline_query','message']},{signal:abort.signal});
      for(const update of updates){
        offset=update.update_id+1;
        if(update.message?.chat?.id===config.ownerId&&update.message?.from?.id===config.ownerId&&update.message.text==='/mix stop')return;
        const q=update.inline_query;if(!q||seen.has(q.id))continue;seen.add(q.id);
        const allocation=pager?pager.receive(q):{results:q.from.id===config.ownerId&&!q.offset?pages[0]:[],next_offset:'',page:1};
        const page=allocation.results;
        if(++answers>500)throw new Error('Probe answer budget exceeded.');
        const start=Date.now();log({type:'answer_started',queryId:q.id,page:allocation.page,rows:page.length,kinds:page.map(r=>r.type),thumbnailRows:page.filter(r=>r.thumbnail_url).length});
        try{await telegram.call(botId,'answerInlineQuery',{inline_query_id:q.id,results:page,next_offset:allocation.next_offset,cache_time:0,is_personal:true},{signal:abort.signal});log({type:'answer_finished',queryId:q.id,page:allocation.page,rows:page.length,more:Boolean(allocation.next_offset),answerMs:Date.now()-start});}
        catch(error){log({type:'answer_failed',queryId:q.id,code:error.code,description:String(error.message).replaceAll(token,'[redacted]').slice(0,300)});}
      }
    }
  }catch(error){if(!abort.signal.aborted)throw error;}
  finally{abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);db?.close();release();log({type:'stopped'});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
  runMixedMediaProbe({signal:stop.signal}).catch(error=>{console.error(JSON.stringify({type:'probe_failed',code:error.code??'probe_failed',description:String(error.message).replace(/bot\d+:[\w-]+/g,'bot[redacted]').slice(0,300)}));process.exitCode=1;});
}
