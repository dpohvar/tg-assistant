// Offline native sandbox check. Supply the absolute path to the Codex executable.
// All files, including the fake Codex home, are disposable synthetic fixtures.
// TG_SKILLS_PROBE_ROOT can choose a writable directory outside the system temp directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openDatabase} from '../../src/storage/database.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';

const executable=process.argv[2];
assert(executable && path.isAbsolute(executable),'Supply an absolute Codex executable path');
const root=fs.mkdtempSync(path.join(process.env.TG_SKILLS_PROBE_ROOT ?? os.homedir(),'tg-skills-sandbox-'));
const home=path.join(root,'home'),bots=path.join(root,'bots'),workspace=path.join(bots,'b');
const db=openDatabase(':memory:');
db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
db.saveChat('b',{id:1,type:'private'});
const scope=db.ensureAgent('b',1);
let launch;
const marker=new Error('captured profile');
const agent=new CodexAgent({db,config:{botsDir:bots,dataDir:path.join(root,'data'),codexHome:home,codexExecutable:executable},prepareMcpArgs:async options=>{launch=options.args;throw marker;}});
const targets={
 skill:path.join(home,'skills','.system','imagegen','SKILL.md'),
 reference:path.join(home,'skills','.system','imagegen','references','prompting.md'),
 otherSkill:path.join(home,'skills','private','SKILL.md'),
 auth:path.join(home,'auth.json'),
 session:path.join(home,'sessions','session.jsonl'),
 otherBot:path.join(bots,'other','secret'),
 otherTemp:path.join(workspace,'.temp','other','secret'),
 ownTemp:path.join(workspace,'.temp',scope.agentId,'canary'),
 workspace:path.join(workspace,'canary'),
};
try {
 for(const filename of Object.values(targets)){fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,'synthetic-canary');}
 const nestedLink=path.join(home,'skills','.system','auth-link');
 fs.symlinkSync(targets.auth,nestedLink);
 targets.nestedLink=nestedLink;
 await assert.rejects(agent.session(scope,async()=>({})),error=>error===marker);
 const overrides=[];
 for(let i=0;i<launch.length;i++)if(launch[i]==='-c')overrides.push('-c',launch[++i]);
 const probe=`const fs=require('node:fs'),targets=${JSON.stringify(targets)},results={};
 for(const [name,file] of Object.entries(targets)){
   let read=false,write=false;
   try{read=fs.readFileSync(file,'utf8')==='synthetic-canary'}catch{}
   try{fs.writeFileSync(file+'.written','test');write=true}catch{}
   results[name]={read,write};
 }
 console.log(JSON.stringify(results));`;
 const output=execFileSync(executable,['sandbox','-P','tg-agent',...overrides,'--',process.execPath,'-e',probe],{cwd:workspace,env:{...process.env,CODEX_HOME:home},encoding:'utf8',timeout:30000});
 const observed=JSON.parse(output.trim());
 for(const [name,filename] of Object.entries(targets)){
  assert.equal(observed[name].read,['skill','reference','ownTemp','workspace'].includes(name),`${name} read`);
  if(['skill','reference','ownTemp','workspace'].includes(name))
   assert.equal(observed[name].write,['ownTemp','workspace'].includes(name),`${name} write`);
  assert.equal(fs.existsSync(filename+'.written'),['ownTemp','workspace'].includes(name),`${name} host write`);
  assert.equal(fs.readFileSync(filename,'utf8'),'synthetic-canary',`${name} host content`);
 }
 const system=path.join(home,'skills','.system');
 fs.rmSync(system,{recursive:true,force:true});
 fs.symlinkSync(home,system,'dir');
 await assert.rejects(agent.session(scope,async()=>({})),/system skills.*directory/i);
 console.log(JSON.stringify({passed:true,checks:observed,symlinkedSystemRejected:true}));
} finally {await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
