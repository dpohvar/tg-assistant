// Opt-in bounded Telegram acceptance. Deterministic agent, production controller; no model calls.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createTelegram} from '../../src/telegram/api.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {fixturePNG} from './inline-fixtures.mjs';

export async function streamInlinePortions({invoke,requestId,photos,mode='photos',signal,pause=ms=>delay(ms,undefined,{signal})}){
  const send=(results,done)=>invoke('set_inline_results',{requestId,results,done});
  await send([{title:'Preparing three images in sequence.',description:'Scroll to see each image as it becomes ready.'}],false);
  if(mode==='status'){await pause(10000);return send([{title:'Work finished.',description:'Final status without a continuation arrow.'}],true);}
  for(let i=0;i<photos.length;i++){
    if(mode!=='ready')await pause(10000);
    const response=await send([photos[i]],i===photos.length-1&&mode!=='late-close');
    if(response.status!=='accepted')return response;
  }
  if(mode==='late-close'){await pause(10000);return send([],true);}
}

export function streamingProbeUpdate(update,ownerId){
  return Boolean(update.inline_query?.from?.id===ownerId||update.message?.from?.id===ownerId&&update.message?.chat?.id===ownerId&&update.message.text==='/stream stop');
}

export async function runStreamingProbe({argv=process.argv.slice(2),signal,telegramFactory=createTelegram,log=event=>console.log(JSON.stringify({at:Date.now(),...event}))}={}){
  const {values}=parseArgs({args:argv,options:{config:{type:'string'},'state-dir':{type:'string'},'duration-seconds':{type:'string',default:'1800'}}});
  if(!values.config||!values['state-dir'])throw new Error('Explicit private test config and fresh state-dir are required.');
  const duration=Number(values['duration-seconds']);if(!Number.isSafeInteger(duration)||duration<30||duration>1800)throw new Error('Duration must be 30..1800 seconds.');
  const file=path.resolve(values.config),config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(config.controllerActive!==false||config.username!=='dpohvar_test_pub_bot'||!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId)||!(config.token||config.tokenFile))throw new Error('Invalid designated test configuration.');
  const root=path.resolve(values['state-dir']);if(fs.existsSync(root))throw new Error('Use a fresh state-dir, preserving earlier probe evidence.');
  const release=acquireLock(path.join(path.dirname(file),'inline-calibration.lock'));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000),stop=()=>abort.abort();
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const native=telegramFactory({getToken:()=>config.token??fs.readFileSync(config.tokenFile,'utf8').trim()}),botId='inline-streaming';
  let controller,db,previousAllowed,pollStarted=false,offset,answerCount=0,cleaning=false;
  const created=[];let failure;
  try{
    fs.mkdirSync(root,{recursive:true});
    const record=event=>{fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify({at:Date.now(),...event})+'\n',{mode:0o600});log(event);};
    const telegram={call:async(id,method,args={},options={})=>{
      if(id!==botId||args.chat_id!==undefined&&args.chat_id!==config.ownerId)throw new Error('Foreign probe target.');
      if(!['getMe','getWebhookInfo','getUpdates','getChat','getUserProfilePhotos','sendPhoto','answerInlineQuery','deleteMessage'].includes(method))throw new Error('Method outside probe scope.');
      if(method==='getUserProfilePhotos'&&args.user_id!==config.botTelegramId)throw new Error('Foreign profile target.');
      if(method==='sendPhoto'&&(created.length>=3||args.disable_notification!==true))throw new Error('Probe buffer budget exceeded.');
      if(method==='deleteMessage'&&!created.includes(args.message_id))throw new Error('Not a probe-created message.');
      if(method==='answerInlineQuery'&&++answerCount>500)throw new Error('Probe answer budget exceeded.');
      const result=await native.call(id,method,args,{...options,signal:cleaning?AbortSignal.timeout(10000):AbortSignal.any([abort.signal,AbortSignal.timeout(method==='getUpdates'?25000:15000)])});
      if(method==='sendPhoto')created.push(result.message_id);
      if(method==='answerInlineQuery')record({type:'page',rows:args.results.length,kinds:args.results.map(r=>r.type),titles:args.results.map(r=>r.title??null),more:Boolean(args.next_offset)});
      return result;
    }};
    const me=await telegram.call(botId,'getMe');if(me.id!==config.botTelegramId||me.username!==config.username||!me.supports_inline_queries)throw new Error('Designated bot identity mismatch.');
    const webhook=await telegram.call(botId,'getWebhookInfo');if(webhook.url)throw new Error('Test bot webhook is active.');
    previousAllowed=webhook.allowed_updates??[];
    db=openDatabase(path.join(root,'controller.sqlite'));
    db.registerBot({botId,telegramId:me.id,username:me.username,ownerId:config.ownerId});
    db.saveChat(botId,await telegram.call(botId,'getChat',{chat_id:config.ownerId}));db.ensureAgent(botId,config.ownerId);
    const photos=[];
    for(const [i,color] of [[40,100,220],[220,70,40],[40,180,90]].entries()){
      const message=await telegram.call(botId,'sendPhoto',{chat_id:config.ownerId,photo:'attach://fixture',caption:'Inline streaming buffer '+(i+1),disable_notification:true},{uploads:[{name:'fixture',bytes:fixturePNG(color),filename:`stream-${i+1}.png`,mime:'image/png'}]});
      db.saveMessage(botId,message);const fileId=message.photo.at(-1).file_id;
      photos.push({native:{type:'photo',id:'photo-'+i,photo_file_id:fileId,caption:'Streaming image '+(i+1)},file_sources:[{messageId:message.message_id,fileId}]});
    }
    const agent={run:async(scope,events,invoke)=>{
      for(const event of events){
        if(event.eventType!=='inline')continue;
        const mode=/^stream (photos|late-close|ready|status)(?:\s|$)/.exec(event.query)?.[1]??'photos';
        record({type:'started',mode,requestId:event.requestId});
        try{await streamInlinePortions({requestId:event.requestId,photos,mode,signal:abort.signal,invoke:async(name,args)=>{const result=await invoke(name,args);record({type:'portion',rows:args.results.length,done:args.done,status:result.status});return result;}});}
        catch(error){if(error.code!=='request_unavailable'&&!abort.signal.aborted)throw error;record({type:'cancelled'});}
      }
    }};
    controller=createController({db,config:{dataDir:path.join(root,'data'),botsDir:path.join(root,'bots'),defaultTimezone:'UTC'},telegram,agent,onError:error=>record({type:'controller_error',code:error.code??'controller_failed'})});
    await controller.ready;
    pollStarted=true;
    const backlog=await telegram.call(botId,'getUpdates',{offset:-1,timeout:0,allowed_updates:['inline_query','message']});offset=backlog.length?backlog.at(-1).update_id+1:undefined;
    record({type:'ready',botUsername:me.username,durationSeconds:duration,modes:['photos','late-close','ready','status'],modelCalls:0});
    while(!abort.signal.aborted&&!fs.existsSync(path.join(root,'stop'))){
      const updates=await telegram.call(botId,'getUpdates',{offset,timeout:15,allowed_updates:['inline_query','message']});
      for(const update of updates){
        offset=update.update_id+1;if(!streamingProbeUpdate(update,config.ownerId))continue;
        if(update.message){abort.abort();break;}
        await controller.receive(botId,update);
      }
    }
  }catch(error){if(!abort.signal.aborted)failure=error;}
  finally{
    abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);controller?.close();await controller?.idle();cleaning=true;
    const cleanup=[];
    for(const messageId of created)try{await native.call(botId,'deleteMessage',{chat_id:config.ownerId,message_id:messageId},{signal:AbortSignal.timeout(10000)});cleanup.push({messageId,deleted:true});}catch{cleanup.push({messageId,deleted:false});}
    let restored=!pollStarted;
    if(pollStarted)try{await native.call(botId,'getUpdates',{offset,timeout:0,allowed_updates:previousAllowed},{signal:AbortSignal.timeout(10000)});restored=true;}catch{restored=false;}
    db?.close();release();
    if(fs.existsSync(root))fs.writeFileSync(path.join(root,'cleanup.json'),JSON.stringify({stopped:true,cleanup,updatesRestored:restored,modelCalls:0},null,2),{mode:0o600});
    log({type:'stopped',buffersDeleted:cleanup.filter(x=>x.deleted).length,updatesRestored:restored});
  }
  if(failure)throw Object.assign(new Error('Inline streaming probe failed.'),{code:failure.code??'probe_failed'});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
  runStreamingProbe({signal:stop.signal}).catch(error=>{console.error(JSON.stringify({type:'probe_failed',code:error.code??'configuration_failed'}));process.exitCode=1;});
}
