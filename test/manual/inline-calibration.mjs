// Opt-in live Telegram runner. It never creates a real model session.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createTelegram} from '../../src/telegram/api.mjs';
import {createInlineRequests} from '../../src/inline/requests.mjs';
import {createInlineService} from '../../src/inline/service.mjs';
import {inlinePolicy} from '../../src/inline/contract.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {prepareInlineFixtures} from './inline-fixtures.mjs';
const validRows=n=>Number.isSafeInteger(n)&&n>=1&&n<=50;
function prefetchScale(values){
  if(!Array.isArray(values)||!values.length||values.length>50||!values.every(validRows))throw new Error('Invalid prefetch page scale.');
  return [...values];
}

// Experimental transport only: no trigger timer, controller, model or synthetic result.
export function createPrefetchProbe({allowed,answer,observe=()=>{},now=Date.now,maxBlocks=500,rowsPerPage=1,pageSizes}){
  if(!validRows(rowsPerPage))throw new Error('Invalid prefetch page size.');
  const scale=pageSizes===undefined?undefined:prefetchScale(pageSizes),size=page=>scale?scale[Math.min(page-1,scale.length-1)]:rowsPerPage;
  const preceding=page=>scale?scale.slice(0,page-1).reduce((a,b)=>a+b,0)+Math.max(0,page-1-scale.length)*scale.at(-1):(page-1)*rowsPerPage;
  const current=new Map(),seen=new Set();let latest;
  const summary=r=>r?{sampleId:r.id,blocks:r.confirmed.size,rows:[...r.confirmed].reduce((total,page)=>total+size(page),0),...(scale?{pageSizes:scale}:{rowsPerPage}),requestedBlocks:r.requested.size,paginationRequests:r.paginationRequests,answerFailures:r.failures,limitReached:r.confirmed.has(maxBlocks),elapsedMs:now()-r.startedAt,quietMs:now()-(r.lastReceivedAt??r.startedAt)}:null;
  return {
    summary:()=>summary(latest),
    close(){for(const r of current.values())observe({type:'prefetch_summary',...summary(r),reason:'closed',at:now()});current.clear();},
    async receive(q){
      if(!q?.id||!q.from?.id||typeof q.query!=='string'||seen.has(q.id))return;seen.add(q.id);
      let r,ordinal;
      if(allowed.has(q.from.id)){
        if(!q.offset){
          const old=current.get(q.from.id);if(old)observe({type:'prefetch_summary',...summary(old),reason:'replaced',at:now()});
          r={id:randomUUID().replaceAll('-',''),startedAt:now(),requested:new Set(),confirmed:new Set(),paginationRequests:0,failures:0,query:q.query};
          current.set(q.from.id,r);latest=r;ordinal=1;
        }else{
          r=current.get(q.from.id);const prefix=r?.id+':',value=q.offset.startsWith(prefix)?q.offset.slice(prefix.length):'';
          ordinal=/^[1-9]\d*$/.test(value)?Number(value):0;
          if(!r||r.failed||r.query!==q.query||ordinal<2||ordinal>maxBlocks||!r.requested.has(ordinal-1))r=undefined;
          else r.paginationRequests++;
        }
      }
      const at=now();if(r){r.lastReceivedAt=at;r.requested.add(ordinal);}
      const results=r?Array.from({length:size(ordinal)},(_,index)=>({type:'article',id:r.id+'-'+ordinal+'-'+index,title:`⬇️ Scroll to send command [${new Date(at).toISOString().slice(11,19)}] [${preceding(ordinal)+index+1}]`,input_message_content:{message_text:'✖️'}})):[];
      // Repeated offsets keep exactly the same result ID/title, so they cannot inflate the unique block count.
      if(r){r.pages??=new Map();if(!r.pages.has(ordinal))r.pages.set(ordinal,results);}
      const body={inline_query_id:q.id,results:r?r.pages.get(ordinal):[],next_offset:r&&ordinal<maxBlocks?r.id+':'+(ordinal+1):'',cache_time:0,is_personal:true};
      observe({type:'prefetch_request',sampleId:r?.id,queryId:q.id,ordinal:r?ordinal:undefined,at});
      try{
        await answer(body);
        if(r){r.confirmed.add(ordinal);observe({type:'prefetch_block',...summary(r),queryId:q.id,ordinal,pageRows:size(ordinal),at:now(),answerMs:now()-at});}
      }catch(error){
        if(r){r.failures++;r.failed=true;}
        observe({type:'prefetch_answer_failed',sampleId:r?.id,queryId:q.id,ordinal:r?ordinal:undefined,code:error.code??'answer_failed',at:now()});
      }
    },
  };
}

export async function runCalibration({argv=process.argv.slice(2),telegramFactory=createTelegram,signal,log=event=>console.log(JSON.stringify(event))}={}){
  const {values}=parseArgs({args:argv,options:{config:{type:'string'},case:{type:'string',default:'prompt'},'trigger-ms':{type:'string',default:'2000'},'wait-ms':{type:'string',default:'5000'},rows:{type:'string',default:'8'},'page-sizes':{type:'string'},'duration-seconds':{type:'string',default:'600'}}});
  if(!values.config)throw new Error('An explicit private --config is required.');
  let pageSizes=values['page-sizes']===undefined?undefined:prefetchScale(values['page-sizes'].split(',').map(Number));
  if(pageSizes&&values.case!=='prefetch')throw new Error('Page scales require the prefetch case.');
  let policy=inlinePolicy({triggerMs:Number(values['trigger-ms']),waitMs:Number(values['wait-ms']),promptRows:pageSizes?.[0]??Number(values.rows)});
  const duration=Number(values['duration-seconds']);if(!Number.isSafeInteger(duration)||duration<1||duration>1800)throw new Error('Invalid duration.');
  const cases=['prompt','waiting','mixed','mixed-reverse','photo-only','photo-direct','production-check','prefetch'];
  let mode=values.case;if(!cases.includes(mode))throw new Error('Invalid calibration case.');
  const filename=path.resolve(values.config),config=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId))throw new Error('Test identity config is required.');
  if(config.controllerActive)throw new Error('The designated test controller was active when credentials were exported.');
  const token=config.token??fs.readFileSync(config.tokenFile,'utf8').trim();
  const botId='inline-calibration',telegram=telegramFactory({getToken:()=>token});
  const me=await telegram.call(botId,'getMe');if(me.id!==config.botTelegramId)throw new Error('Test bot identity mismatch.');
  if(!me.supports_inline_queries)throw new Error('Inline mode is disabled for the test bot.');
  const webhook=await telegram.call(botId,'getWebhookInfo');if(webhook.url)throw new Error('The test bot has an active webhook.');
  const release=acquireLock(path.join(path.dirname(filename),'inline-calibration.lock'));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000);
  const stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  let service,prefetch,requests,offset,fixtures,readyMs=['mixed','mixed-reverse','photo-only','photo-direct'].includes(mode)?800:30000,label='unlabelled',pageNumber=0;
  const synthetic=new Map(),created=[],allowed=new Set(config.allowedUserIds??[config.ownerId]);
  const observe=e=>log({label,case:mode,promptRows:policy.promptRows,...(pageSizes?{pageSizes}:{}),triggerMs:policy.triggerMs,waitMs:policy.waitMs,...e});
  const owner=userId=>({botId,userId,agentId:'probe-'+userId,chatId:userId});
  function install(){
    service?.close();prefetch?.close();prefetch=undefined;
    if(mode==='prefetch'){
      prefetch=createPrefetchProbe({allowed,observe,rowsPerPage:policy.promptRows,pageSizes,answer:body=>telegram.call(botId,'answerInlineQuery',body,{signal:abort.signal})});return;
    }
    requests=createInlineRequests({policy});
    service=createInlineService({requests,resolveActor:(_b,userId)=>allowed.has(userId)?owner(userId):null,observe,
      cancelPending:id=>{clearTimeout(synthetic.get(id));synthetic.delete(id);},
      enqueue:(scope,event,admit)=>{
        const handle=setTimeout(()=>{
          synthetic.delete(event.requestId);if(!admit())return;
          const results=mode==='mixed'?fixtures:mode==='mixed-reverse'?[...fixtures].reverse():mode==='photo-only'?fixtures.filter(item=>item.type==='photo'):[{type:'article',id:'probe-ready',title:'Test result ready',input_message_content:{message_text:'Inline calibration result'}}];
          try{service.setResults(scope,{requestId:event.requestId,results});}catch(error){observe({type:'synthetic_result_rejected',code:error.code??'failed'});}
        },readyMs);synthetic.set(event.requestId,handle);return 'accepted';
      },
      normalizeResults:(_s,result)=>result.map(native=>({native})),registerPage:(_s,result)=>result.map(x=>x.native),
      answer:(id,body)=>{
        const page=++pageNumber;
        const results=body.results.map((result,index)=>result.type==='article'?{...result,title:`[${page}:${index+1}] ${result.title}`,description:`Probe page ${page}, item ${index+1} of ${body.results.length}`} : result);
        return telegram.call(id,'answerInlineQuery',{...body,results},{signal:abort.signal});
      }});
  }
  async function control(message){
    if(message.chat?.id!==config.ownerId||message.from?.id!==config.ownerId||typeof message.text!=='string'||!message.text.startsWith('/probe'))return;
    const [,command,value]=message.text.trim().split(/\s+/);
    try{
      if(['rows','trigger','wait'].includes(command)){
        const property={rows:'promptRows',trigger:'triggerMs',wait:'waitMs'}[command];
        policy=inlinePolicy({triggerMs:policy.triggerMs,waitMs:policy.waitMs,promptRows:policy.promptRows,[property]:Number(value)});if(command==='rows')pageSizes=undefined;install();
      }else if(command==='ready'){
        const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>600000)throw new Error('Invalid ready delay');readyMs=n;
      }else if(command==='sample'){
        if(!/^[a-zA-Z0-9_-]{1,40}$/.test(value??''))throw new Error('Invalid sample label');
        if(mode==='prefetch'){prefetch?.close();prefetch=undefined;}label=value;if(mode==='prefetch')install();
      }else if(command==='case'){
        if(!cases.includes(value))throw new Error('Invalid case');
        if(['mixed','mixed-reverse','photo-only','photo-direct'].includes(value)&&!fixtures)fixtures=await prepareInlineFixtures({telegram,botId,ownerId:config.ownerId,created,signal:abort.signal});
        mode=value;install();
      }else if(command==='stop'){abort.abort();return;}
      const sample=prefetch?.summary();if(command==='summary'&&sample)observe({type:'prefetch_summary',...sample,reason:'command',at:Date.now()});
      const text=mode==='prefetch'?`Probe: prefetch; ${pageSizes?'page sizes='+pageSizes.join(',')+' (repeat last)':'rows per page='+policy.promptRows}; no agent; label=${label}`+(command==='summary'&&sample?`\nConfirmed blocks: ${sample.blocks}; confirmed rows: ${sample.rows}; pagination requests: ${sample.paginationRequests}; errors: ${sample.answerFailures}; cap reached: ${sample.limitReached}; quiet: ${sample.quietMs}ms`:''):`Probe: ${mode}; rows=${policy.promptRows}; trigger=${policy.triggerMs}ms; wait=${policy.waitMs}ms; ready=${readyMs}ms; label=${label}`;
      await telegram.call(botId,'sendMessage',{chat_id:config.ownerId,text,disable_notification:true},{signal:abort.signal});
      observe({type:'control',command:command??'status'});
    }catch(error){observe({type:'control_failed',code:error.code??'invalid_control'});}
  }
  try{
    if(['mixed','mixed-reverse','photo-only','photo-direct'].includes(mode))fixtures=await prepareInlineFixtures({telegram,botId,ownerId:config.ownerId,created,signal:abort.signal});
    install();
    if(mode==='prefetch'){
      const backlog=await telegram.call(botId,'getUpdates',{offset:-1,timeout:0},{signal:abort.signal});
      offset=backlog.at(-1)?.update_id+1;if(!Number.isSafeInteger(offset))offset=undefined;
    }
    observe({type:'ready',botUsername:me.username,durationSeconds:duration});
    while(!abort.signal.aborted){
      const updates=await telegram.call(botId,'getUpdates',{offset,timeout:20,allowed_updates:['inline_query','message']},{signal:abort.signal});
      for(const update of updates){
        if(abort.signal.aborted)break;
        offset=update.update_id+1;
        if(update.inline_query) {
          if(mode==='prefetch')await prefetch.receive(update.inline_query);
          else if(mode==='photo-direct'){
            const query=update.inline_query,results=allowed.has(query.from.id)?fixtures.filter(item=>item.type==='photo'):[];
            await telegram.call(botId,'answerInlineQuery',{inline_query_id:query.id,results,next_offset:'',cache_time:0,is_personal:true},{signal:abort.signal});
            observe({type:'native_control_answer',rows:results.length,resultKinds:results.map(item=>item.type)});
          }else service.receive(botId,update.inline_query);
        }
        if(update.message)await control(update.message);
      }
    }
  }catch(error){if(!abort.signal.aborted)throw Object.assign(new Error('Calibration Telegram operation failed.'),{code:error.code??'probe_failed'});}
  finally{
    abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);
    service?.close();prefetch?.close();await service?.idle();for(const h of synthetic.values())clearTimeout(h);
    for(const messageId of created)try{await telegram.call(botId,'deleteMessage',{chat_id:config.ownerId,message_id:messageId},{signal:AbortSignal.timeout(5000)});}catch{observe({type:'cleanup_failed',messageId});}
    release();observe({type:'stopped'});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  runCalibration({signal:controller.signal}).catch(error=>{console.error(JSON.stringify({type:'probe_failed',code:error.code??'configuration_failed'}));process.exitCode=1;});
}
