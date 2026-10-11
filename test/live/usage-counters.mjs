// Isolated live accounting probe. No Telegram calls, production DB or bot workspace changes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {RpcProcess} from '../../src/codex/rpc.mjs';
const [configFile,root,mode='full']=process.argv.slice(2);
assert(configFile&&root);
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
fs.mkdirSync(root,{recursive:true});
const cwd=path.join(root,'wiki');fs.mkdirSync(path.join(cwd,'.temp','usage'),{recursive:true});fs.mkdirSync(path.join(cwd,'.git'),{recursive:true});
const allow={':minimal':'read',[cwd]:'write',[path.join(cwd,'.git')]:'deny',[path.join(cwd,'.temp')]:'deny',[path.join(cwd,'.temp','usage')]:'write',[path.dirname(config.codexExecutable)]:'read'};
const toml='{'+Object.entries(allow).map(([p,v])=>JSON.stringify(p)+'='+JSON.stringify(v)).join(',')+'}';
const env={...process.env,CODEX_HOME:config.codexHome};for(const k of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|API_KEY/i.test(k))delete env[k];
const args=['app-server','--stdio','--strict-config','-c','approval_policy="never"','-c','default_permissions="tg-agent"','-c',`permissions.tg-agent.filesystem=${toml}`,'-c','permissions.tg-agent.network={enabled=true}','-c','features.multi_agent=true','-c','web_search="live"'];
const report={startedAt:new Date().toISOString(),events:[],results:[]};let phase='start',rpc,threadId;const owned=new Set(),pendingChildren=new Set();
function note(v){const event={at:new Date().toISOString(),phase,...v};report.events.push(event);fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(event));}
async function connect(){
 rpc=new RpcProcess({executable:config.codexExecutable,args,cwd,env});
 rpc.on('notification',m=>{
  const p=m.params??{},i=p.item;
  if(m.method==='thread/tokenUsage/updated')note({method:m.method,threadId:p.threadId,turnId:p.turnId,usage:p.tokenUsage});
  if(i?.type==='subAgentActivity'&&i.kind==='started'){owned.add(i.agentThreadId);pendingChildren.add(i.agentThreadId);note({kind:'childStarted',threadId:p.threadId,child:i.agentThreadId});}
  if(m.method==='turn/completed'){pendingChildren.delete(p.threadId);note({kind:'turnCompleted',threadId:p.threadId,status:p.turn.status});}
  if(i?.type==='imageGeneration'){
   let bytes=null;try{if(m.method==='item/completed'&&i.savedPath)bytes=fs.statSync(i.savedPath).size;}catch{}
   note({method:m.method,kind:'image',threadId:p.threadId,itemId:i.id,status:i.status,hasFailure:!!i.failure,bytes});
  }
  if(/compact/i.test(m.method)||i?.type==='contextCompaction')note({method:m.method,kind:'compaction',threadId:p.threadId});
 });
 await rpc.request('initialize',{clientInfo:{name:'usage_probe',version:'0.1'},capabilities:{experimentalApi:true}});rpc.notify('initialized');
}
async function turn(label,text){
 phase=label;const offset=report.events.length;
 const finished=rpc.waitFor(m=>m.method==='turn/completed'&&m.params.threadId===threadId,240000);
 await rpc.request('turn/start',{threadId,input:[{type:'text',text,text_elements:[]}]});
 const m=await finished;assert.equal(m.params.turn.status,'completed');
 const deadline=Date.now()+180000;while(pendingChildren.size&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));assert.equal(pendingChildren.size,0);
 await new Promise(r=>setTimeout(r,300));
 const rows=report.events.slice(offset).filter(e=>e.usage);report.results.push({label,usageUpdates:rows.length,threads:[...new Set(rows.map(e=>e.threadId))]});
 note({kind:'phaseFinished',label,usageUpdates:rows.length});
}
const watchdog=setTimeout(()=>rpc?.close(),720000);
try{
 await connect();const started=await rpc.request('thread/start',{cwd,permissions:'tg-agent',approvalPolicy:'never',developerInstructions:'Bounded runtime accounting test. Follow each requested step. Never access other workspaces, secrets or private user data. Reply only with requested short results.'});threadId=started.thread.id;owned.add(threadId);report.rootThread=threadId;
 await turn('ordinary-1','Reply exactly: accounting one. Do not call tools.');
 await turn('ordinary-2','Reply exactly: accounting two. Do not call tools.');
 if(mode==='fork'){
  await turn('fork-child','Spawn exactly one subagent using fork_context:true so it inherits this conversation. Ask it to reply exactly FORK DONE without tools or additional agents. Wait for it to finish and then reply ROOT DONE. Do not do its task yourself.');
 }else{
 await turn('child','Spawn exactly one subagent. Ask it to reply exactly CHILD DONE without tools or additional agents. Wait for it to finish and then reply ROOT DONE. Do not do its task yourself.');
 phase='resume';await rpc.close();await connect();await rpc.request('thread/resume',{threadId,cwd,permissions:'tg-agent',approvalPolicy:'never'});
 await turn('after-resume','Reply exactly: resumed. No tools.');
 phase='compact';const compacted=rpc.waitFor(m=>m.params?.threadId===threadId&&(m.method==='thread/compacted'||m.method==='item/completed'&&m.params.item?.type==='contextCompaction'),180000);
 const compactTurn=rpc.waitFor(m=>m.method==='turn/completed'&&m.params?.threadId===threadId,180000);
 await rpc.request('thread/compact/start',{threadId});await compacted;await compactTurn;
 await turn('after-compact','Reply exactly: compacted. No tools.');
 await turn('image','Generate exactly one small simple image: a blue circle on a plain white background. Use the native image generation tool once, no subagents. Do not print base64 or the result object. After generation reply DONE.');
 }
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;console.error(e.message);process.exitCode=1;}
finally{
 clearTimeout(watchdog);phase='cleanup';
 if(rpc&&!rpc.failure)for(const id of [...owned].reverse())try{await rpc.request('thread/delete',{threadId:id});}catch(e){note({kind:'cleanupFailed',error:e.message});}
 await rpc?.close();report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
}
