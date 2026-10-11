// Real Codex through the production adapter and SQLite store; no Telegram calls or production DB.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';
import {createUsageStore} from '../../src/storage/usage.mjs';
import {usageReport,parseUsageReport} from '../../src/commands/usage.mjs';
const [configFile,root,mode='full']=process.argv.slice(2);assert(configFile&&root);
const config={...JSON.parse(fs.readFileSync(configFile,'utf8')),dataDir:path.join(root,'control'),botsDir:path.join(root,'bots')};
const db=openDatabase(path.join(config.dataDir,'db'));db.registerBot({botId:'probe',telegramId:42,username:'usage_probe_bot',ownerId:1});db.saveChat('probe',{id:1,type:'private',first_name:'Probe'});const scope=db.ensureAgent('probe',1),store=createUsageStore(db),agent=new CodexAgent({db,config});let images=0;
agent.onImage=()=>images++;
const invoke=async(name,args)=>{
 if(name==='save_image')return {path:args.savedPath}; // metadata-only test response, no source copy
 if(name==='time')return {now:new Date().toISOString()};
 return {error:'probe_no_external_actions',description:'This probe does not send Telegram messages or change external data.'};
};
const summary=[];
async function turn(text){const {settled}=await agent.run(scope,[{type:'message',textPlain:text}],invoke);await settled;const total=store.list()[0].total;summary.push({...total});console.log(JSON.stringify({turn:summary.length,...total}));}
const timeout=setTimeout(()=>agent.close(),360000);
try{
 await turn('Authorized isolated accounting test. Reply only in your internal final text: ONE. Do not use any tools or publish to Telegram.');assert(summary[0].inputTokens>0);
 agent.detach(scope.agentId);await turn('Authorized isolated accounting test. Reply only in your internal final text: TWO. No tools or publishing.');assert(summary[1].inputTokens>summary[0].inputTokens);
 await turn('Authorized isolated accounting test. Spawn one native subagent to reply CHILD DONE internally, without tools or Telegram publishing. Wait for it and reply ROOT DONE internally. No other tasks.');
 assert(db.sql.prepare('SELECT count(*) n FROM usage_threads WHERE threadId!=rootThreadId').get().n>0);
 if(mode==='full'){await turn('Authorized isolated accounting test. Generate exactly one native image, a small orange circle on white. No Telegram publishing. Save_image in this probe is metadata-only; do not copy files yourself. Then finish internally.');assert.equal(images,1);assert.equal(store.list()[0].total.imageGenerations,1);assert(store.list()[0].total.imageBytes>0);}
 else {const s=agent.sessions.get(scope.agentId),done=s.rpc.waitFor(m=>m.method==='turn/completed'&&m.params?.threadId===s.threadId);await s.rpc.request('thread/compact/start',{threadId:s.threadId});await done;await turn('Authorized isolated accounting test after compaction. Reply internally COMPACT DONE. No tools or Telegram publishing.');assert(summary.at(-1).inputTokens>summary.at(-2).inputTokens);}
 const total=store.list()[0].total;
 const output=usageReport({db,args:['@usage_probe_bot','hours']});assert.equal(parseUsageReport(output.text).rows[0].total.inputTokens,total.inputTokens);
 console.log(JSON.stringify({passed:true,realAdapter:true,rootAndChild:true,resume:true,imageSize:mode==='full',compaction:mode!=='full',reportRoundTrip:true,total}));
}finally{
 clearTimeout(timeout);const childIds=db.sql.prepare('SELECT threadId FROM usage_threads WHERE threadId!=rootThreadId').all().map(r=>r.threadId);await agent.deleteSession(scope.agentId,db.agent('probe',1).threadId);
 for(const threadId of childIds)try{await(await agent.catalogRpc()).request('thread/delete',{threadId});}catch{}
 await agent.close();db.close();
}
