// Explicit opt-in; real legacy/current services, unchanged archive and real user callbacks.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTelegram} from '../../src/telegram/api.mjs';
import {BotFiles} from '../../src/files/paths.mjs';
import {createWidgetEvents} from '../../src/widgets/events.mjs';
import {acquireLock} from '../../src/service/lock.mjs';
import {WORDLE_ARCHIVE_SHA,sourceHashes} from '../helpers/wordle-fixture.mjs';
import {verifyNativeManagement} from './wordle-native-management.mjs';

export async function runWordleMigration({argv=process.argv.slice(2),signal,log=e=>console.log(JSON.stringify(e))}={}){
  const {values:v}=parseArgs({args:argv,options:{config:{type:'string'},archive:{type:'string'},'old-root':{type:'string'},'native-config':{type:'string'},'keep-active':{type:'boolean'},phase:{type:'string'},'state-dir':{type:'string'},'duration-seconds':{type:'string',default:'600'}}});
  if(!v.config||!v.archive||!v['old-root']||!v['state-dir']||!['before','after'].includes(v.phase))throw new Error('Explicit config/archive/old-root/phase/state-dir are required.');
  const duration=Number(v['duration-seconds']);if(!Number.isSafeInteger(duration)||duration<1||duration>1800)throw new Error('Invalid duration');
  if(createHash('sha256').update(fs.readFileSync(v.archive)).digest('hex')!==WORDLE_ARCHIVE_SHA)throw new Error('Wordle archive mismatch');
  const filename=path.resolve(v.config),privateConfig=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(privateConfig.controllerActive||!Number.isSafeInteger(privateConfig.ownerId)||!Number.isSafeInteger(privateConfig.botTelegramId)||!privateConfig.codexExecutable)throw new Error('Designated inactive bot and sandbox executable are required.');
  const root=path.resolve(v['state-dir']),manifestFile=path.join(root,'manifest.json');
  if(v.phase==='before'&&fs.existsSync(manifestFile))throw new Error('Use a fresh state directory for BEFORE.');
  const release=acquireLock(path.join(path.dirname(filename),'inline-calibration.lock'));
  const abort=new AbortController(),stop=()=>abort.abort(),timer=setTimeout(stop,duration*1000);signal?.addEventListener('abort',stop,{once:true});
  let db,service,phase=v.phase,offset,manifest,scope;const created=new Set(),botId='wordle-migration';
  const config={dataDir:path.join(root,'data'),botsDir:path.join(root,'bots'),codexExecutable:privateConfig.codexExecutable};
  const workspace=path.join(config.botsDir,botId),token=privateConfig.token??fs.readFileSync(privateConfig.tokenFile,'utf8').trim();
  const native=createTelegram({getToken:()=>token});let sends=0,edits=0;
  const telegram={call:async(b,method,args={},options={})=>{
    if(b!==botId)throw new Error('Foreign bot');
    if(!['getMe','getWebhookInfo','getChat','getUpdates','sendMessage','sendRichMessage','editMessageText','editMessageReplyMarkup','answerCallbackQuery','deleteMessage'].includes(method))throw new Error('Unexpected Telegram operation '+method);
    if(args.chat_id!==undefined&&args.chat_id!==privateConfig.ownerId)throw new Error('Foreign chat');
    if(method.startsWith('send')&&++sends>4||method.startsWith('edit')&&++edits>128)throw new Error('Fixture effect budget exceeded');
    if((method.startsWith('edit')||method==='deleteMessage')&&!created.has(args.message_id))throw new Error('Foreign message');
    const result=await native.call(b,method,args,{...options,signal:AbortSignal.timeout(30000)});
    if(method.startsWith('send')&&result?.message_id)created.add(result.message_id);
    return result;
  }};
  const report=e=>log({at:Date.now(),phase,...e}),saveManifest=()=>fs.writeFileSync(manifestFile,JSON.stringify(manifest),{mode:0o600});
  async function settled(){const end=Date.now()+20000;while(Date.now()<end){if(db.sql.prepare('SELECT count(*) n FROM widget_events WHERE widgetId=?').get(manifest.widgetId).n===0){await service.idle();return;}await new Promise(r=>setTimeout(r,25));}throw new Error('Widget queue did not settle');}
  async function open(current){
    const base=current?path.resolve('src'):path.join(path.resolve(v['old-root']),'src');
    const [{openDatabase},{createWidgetService}]=await Promise.all([import(pathToFileURL(path.join(base,'storage/database.mjs'))),import(pathToFileURL(path.join(base,'widgets/service.mjs')))]);
    db=openDatabase(path.join(config.dataDir,'controller.sqlite'));
    if(!manifest){db.registerBot({botId,telegramId:privateConfig.botTelegramId,username:me.username,ownerId:privateConfig.ownerId});db.saveChat(botId,chat);const agent=db.ensureAgent(botId,privateConfig.ownerId);scope={botId,agentId:agent.agentId,chatId:privateConfig.ownerId};}
    else scope=manifest.scope;
    service=createWidgetService({db,config,telegram,filesFor:s=>new BotFiles(path.join(config.botsDir,s.botId),s.agentId),invoke:async(_s,name)=>{if(name==='user_roles')return {users:[{userId:privateConfig.ownerId,role:'owner'}]};throw new Error('Unexpected Wordle API');},notify:async(_s,e)=>report({type:'widget_event',eventType:e.eventType,code:e.error})});
    if(manifest)await service.recover();
  }
  let me,chat;
  try{
    me=await telegram.call(botId,'getMe');assert.equal(me.id,privateConfig.botTelegramId);
    assert.equal((await telegram.call(botId,'getWebhookInfo')).url,'');chat=await telegram.call(botId,'getChat',{chat_id:privateConfig.ownerId});assert.equal(chat.type,'private');
    fs.mkdirSync(root,{recursive:true});
    if(phase==='before'){
      fs.mkdirSync(workspace,{recursive:true});execFileSync('tar',['-xf',path.relative(workspace,path.resolve(v.archive)).replaceAll('\\','/')],{cwd:workspace,windowsHide:true});
      const hashes=sourceHashes(workspace);await open(false);
      const result=await service.set(scope,{handler:'widgets/wordle/widget.tsx',description:'Wordle migration acceptance',state:{inactivityMs:60000,notify:false},disable_notification:true});
      const w=service.store.get(result.widgetId);manifest={scope,widgetId:w.widgetId,messageId:w.messageId,sourceHashes:hashes,created:[...created],beforeState:w.state,checks:[]};saveManifest();
      report({type:'ready',instruction:'Play the legacy Wordle: Start, then one letter.'});
    }else{
      manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));offset=manifest.updateOffset;assert.deepEqual(sourceHashes(workspace),manifest.sourceHashes);
      for(const id of manifest.created)created.add(id);await open(true);
      const w=service.store.get(manifest.widgetId),views=service.store.listViews(w.widgetId);assert.equal(w.status,'active');assert.equal(views.length,1);assert.equal(views[0].target.messageId,manifest.messageId);
      manifest.viewId=views[0].id;manifest.checks.push('same-widget-address-after-migration');saveManifest();
      if(v['native-config']){
        await verifyNativeManagement({filename:v['native-config'],root,db,service,scope,widgetId:w.widgetId,signal:abort.signal,report});
        manifest.checks.push('native-model-list-get-update','native-session-reset-preserves-widget');saveManifest();
      }
      report({type:'ready',instruction:'Press another letter on the old Wordle message.'});
    }
    let receive=phase==='after'?createWidgetEvents({db,manager:service,telegram}):null,stage=0,userStopped=false;
    while(!abort.signal.aborted&&!fs.existsSync(path.join(root,'stop'))){
      const updates=await native.call(botId,'getUpdates',{offset,timeout:10,allowed_updates:['callback_query','message']},{signal:abort.signal});
      for(const update of updates){offset=update.update_id+1;manifest.updateOffset=offset;saveManifest();if(abort.signal.aborted)break;
        if(update.message?.from?.id===privateConfig.ownerId&&update.message.text==='/wordle stop'){userStopped=true;abort.abort();break;}
        const cb=update.callback_query;if(!cb)continue;
        if(cb.from?.id!==privateConfig.ownerId||cb.message?.chat?.id!==privateConfig.ownerId||!created.has(cb.message.message_id)){await telegram.call(botId,'answerCallbackQuery',{callback_query_id:cb.id}).catch(()=>{});continue;}
        report({type:'callback_started',messageId:cb.message.message_id});
        if(phase==='before'){
          const w=service.store.byMessage(botId,cb.message.chat.id,cb.message.message_id);
          if(w&&w.buttonNames.includes(cb.data))await service.admit(w,{name:cb.data.split(':')[0],source:'button',data:cb,receivedAt:new Date().toISOString(),delayed:false});
        }else await receive(botId,update);
        await settled();assert.deepEqual(sourceHashes(workspace),manifest.sourceHashes);
        report({type:'callback_finished',messageId:cb.message.message_id});
        if(!cb.data.startsWith('key:'))continue;
        const w=service.store.get(manifest.widgetId);if(w.status!=='active')throw new Error('Wordle stopped');
        if(phase==='before'){
          assert.ok(w.state.players?.[String(privateConfig.ownerId)]?.input);manifest.beforeState=w.state;manifest.created=[...created];manifest.checks.push('legacy-real-button-play');saveManifest();
          await service.close();service=null;db.close();db=null;fs.copyFileSync(path.join(config.dataDir,'controller.sqlite'),path.join(root,'before.sqlite'));
          report({type:'before_complete',archiveUnchanged:true});return manifest;
        }
        if(stage===0){
          manifest.checks.push('old-button-after-migration');const saved=structuredClone(w.state);
          await service.update(scope,{widgetId:w.widgetId,handler:'widgets/wordle/widget.tsx'});assert.deepEqual(service.store.get(w.widgetId).state,saved);
          const second=await service.setView(scope,{widgetId:w.widgetId,send:{disable_notification:true},props:{}});manifest.secondViewId=second.viewId;manifest.secondMessageId=second.target.messageId;manifest.created=[...created];saveManifest();
          await service.close();db.close();await open(true);receive=createWidgetEvents({db,manager:service,telegram});stage=1;
          report({type:'second_view_ready',instruction:'Press a letter on the SECOND Wordle message; both should update.'});
        }else if(stage===1&&cb.message.message_id===manifest.secondMessageId){
          const views=service.store.listViews(w.widgetId);assert.equal(views.length,2);assert.ok(views.every(view=>view.message?.rich_message));
          manifest.checks.push('handler-update-keeps-state','second-restart','shared-game-from-second-view');
          if(v['keep-active']){stage=3;saveManifest();report({type:'shared_play_ready',instruction:'Both messages remain active. Play from either. Send /wordle stop only after visual verification.'});continue;}
          await service.deleteView(scope,{viewId:manifest.secondViewId});stage=2;saveManifest();
          report({type:'view_detached',instruction:'Second keyboard is disabled. Press one more letter on the FIRST message.'});
        }else if(stage===2&&cb.message.message_id===manifest.messageId){
          manifest.checks.push('detachment-keeps-first-view-working');await service.delete(scope,{widgetId:w.widgetId});assert.equal(service.store.get(w.widgetId),null);manifest.checks.push('delete-disables-remaining-view');manifest.sourceUnchanged=true;saveManifest();report({type:'after_complete',checks:manifest.checks,archiveUnchanged:true});return manifest;
        }
      }
    }
    if(v['keep-active']&&stage===3&&userStopped){manifest.checks.push('manual-shared-play-finished');saveManifest();report({type:'shared_play_finished',checks:manifest.checks});}
    else report({type:'incomplete',reason:'bounded_run_ended'});return manifest;
  }finally{
    if(v['keep-active']&&service&&manifest&&phase==='after'&&service.store.get(manifest.widgetId))await service.delete(scope,{widgetId:manifest.widgetId});
    abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);await service?.close();db?.close();release();
    if(manifest){manifest.created=[...created];saveManifest();}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  runWordleMigration({signal:abort.signal}).catch(error=>{console.error(JSON.stringify({type:'wordle_acceptance_failed',code:error.code??'acceptance_failed',message:String(error.message).slice(0,240)}));process.exitCode=1;});
}
