// Explicit native inference acceptance. No Telegram sends or polling.
// node test/manual/agent-control-native.mjs PRIVATE_NATIVE_CONFIG
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';import {CodexAgent} from '../../src/codex/threads.mjs';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(c.username!=='dpohvar_test_pub_bot'||!c.codexExecutable||!c.codexHome)throw Error('Designated native test config required.');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-agent-control-native-')),db=openDatabase(path.join(root,'db.sqlite'));
const config={dataDir:path.join(root,'data'),botsDir:path.join(root,'bots'),codexExecutable:c.codexExecutable,codexHome:c.codexHome,defaultTimezone:'UTC'};
db.registerBot({botId:'native-control-test',telegramId:c.botTelegramId,username:c.username,ownerId:c.ownerId});db.saveChat('native-control-test',{id:c.ownerId,type:'private'});const scope=db.ensureAgent('native-control-test',c.ownerId),agent=new CodexAgent({db,config});
const results=[],log=(stage,data={})=>{results.push({stage,...data});console.log(JSON.stringify(results.at(-1)));};
const invoke=async name=>{if(name!=='context_status')throw Error('Only context_status allowed in native probe');return agent.context.snapshot(scope.agentId);};
const events=text=>[{eventType:'message',textPlain:text,from:{userId:c.ownerId,name:'Test owner'},messageId:1}];
try{
 log('start');await (await agent.run(scope,events('Authorized disposable integration test. Call context_status once, then finish. Do not send Telegram messages or access files.'),invoke))?.settled;
 log('initial_turn_completed',{contextMeasured:agent.context.snapshot(scope.agentId).usedTokens!==null});
 const identity={};const compact=await agent.compact(scope,{timeout:90000,onProgress:x=>Object.assign(identity,x)});log('compact',{state:compact.state,hasTurn:!!identity.turnId,hasItem:!!identity.itemId});
 if(compact.state==='completed'){const recovered=await agent.reconcileControl(scope,identity);log('compact_readback',{state:recovered.state});}
 const temp=path.join(config.botsDir,scope.botId,'.temp',scope.agentId);fs.mkdirSync(temp,{recursive:true});
 const command=name=>process.platform==='linux'?`printf ready > .temp/${scope.agentId}/${name}.ready; i=0; while [ $i -lt 120 ]; do i=$((i+1)); printf '%s' $i > .temp/${scope.agentId}/${name}.tick; sleep 1; done`:`Set-Content -LiteralPath .temp/${scope.agentId}/${name}.ready -Value ready; 1..120 | ForEach-Object { Set-Content -LiteralPath .temp/${scope.agentId}/${name}.tick -Value $_; Start-Sleep -Seconds 1 }`;
 let failure,finished=false;const work=agent.run(scope,events(`Authorized disposable cancellation test on ${process.platform==='linux'?'Linux POSIX shell':'Windows PowerShell'}. Start a child agent whose task is to execute exactly this command and wait for it: ${command('child')}. In parallel execute yourself: ${command('root')}. Start both before waiting. Use exec yield 1000 ms, then keep waiting. These are authorized temporary marker writes; do not send messages or access other files. Do not use Node.js.`),invoke).catch(e=>{failure=e.code;}).finally(()=>{finished=true;});
 const end=Date.now()+90000;while(!fs.existsSync(path.join(temp,'root.ready'))||!fs.existsSync(path.join(temp,'child.ready'))){if(Date.now()>end||finished)break;await new Promise(r=>setTimeout(r,100));}
 const rootStarted=fs.existsSync(path.join(temp,'root.ready')),childStarted=fs.existsSync(path.join(temp,'child.ready'));log('long_work_started',{root:rootStarted,child:childStarted});
 const stopped=await agent.interrupt(scope.agentId);log('interrupt',{state:stopped.state,code:stopped.code});await work;
 assert.equal(stopped.state,'interrupted');assert.ok(rootStarted&&childStarted,'Both owned commands must actually run.');assert.equal(failure,'agent_cancelled');
 const ticks=()=>['root','child'].map(name=>fs.readFileSync(path.join(temp,name+'.tick'),'utf8'));const stoppedTicks=ticks();await new Promise(r=>setTimeout(r,1300));assert.deepEqual(ticks(),stoppedTicks);log('no_late_command_effects');
 const saved=db.agent(scope.botId,scope.chatId).threadId;assert.ok(saved);
 await (await agent.run(scope,events('The interrupted work was intentionally cancelled. Do not resume either script or spawn children. Call context_status once and finish.'),invoke))?.settled;
 assert.equal(db.agent(scope.botId,scope.chatId).threadId,saved);log('saved_thread_resumed');
}catch(e){log('failed',{code:e.code??e.name,rpcMethod:e.diagnostic?.rpcMethod,failureStage:e.diagnostic?.stage});process.exitCode=1;}finally{
 await agent.interrupt(scope.agentId);await agent.close();db.close();fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({platform:process.platform,node:process.version,results},null,2));console.log(JSON.stringify({artifact:root}));
}
