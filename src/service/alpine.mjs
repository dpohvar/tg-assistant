import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireLock} from './lock.mjs';
const defaultEntry=fileURLToPath(new URL('../main.mjs',import.meta.url));
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new Error('Invalid service state file; inspect it manually.');}}
function processInfo(pid){
 try{const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');if(fields[0]==='Z')return null;return {birth:fields[19],argv:fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean),cwd:fs.realpathSync(`/proc/${pid}/cwd`),uid:fs.statSync(`/proc/${pid}`).uid,exe:fs.realpathSync(`/proc/${pid}/exe`)};}
 catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}
}
function checked(owner,entry,configFile){
 if(!Number.isSafeInteger(owner?.pid)||owner.pid<=0||typeof owner.nonce!=='string')throw new Error('Invalid controller lock; inspect it manually.');
 const info=processInfo(owner.pid);if(!info)return null;
 const actualEntry=info.argv[1]&&path.resolve(info.cwd,info.argv[1]);const actualConfig=path.resolve(info.cwd,info.argv[2]??'config.json');
 if(info.uid!==process.getuid()||info.exe!==fs.realpathSync(process.execPath)||actualEntry!==entry||actualConfig!==configFile)throw new Error('Controller PID identity does not belong to this service/config; refusing to signal it.');
 return info;
}
export async function serviceCommand(action,filename='config.json',{entry=defaultEntry,timeoutMs=60000}={}){
 if(process.platform!=='linux')throw new Error('These service commands require Alpine/Linux.');
 if(!['start','stop','status'].includes(action))throw new Error('Expected start, stop or status.');
 const configFile=fs.realpathSync(path.resolve(filename));entry=fs.realpathSync(entry);
 const config=JSON.parse(fs.readFileSync(configFile,'utf8'));if(!path.isAbsolute(config.dataDir??''))throw new Error('dataDir must be absolute.');
 fs.mkdirSync(config.dataDir,{recursive:true});
 const lock=path.join(config.dataDir,'controller.lock'),ready=path.join(config.dataDir,'controller.ready'),log=path.join(config.dataDir,'service.log');
 const status=()=>{const owner=readJson(lock);const info=owner&&checked(owner,entry,configFile);if(!info)return {state:'stopped',log};const marker=readJson(ready);return {state:marker?.pid===owner.pid&&marker?.nonce===owner.nonce?'running':'starting',pid:owner.pid,log};};
 if(action==='status')return status();
 const release=acquireLock(path.join(config.dataDir,'service-command.lock'));
 try{
  const current=status();
  if(action==='stop'){
   if(current.state==='stopped')return current;
   const owner=readJson(lock),info=owner&&checked(owner,entry,configFile);if(!info)return {state:'stopped',log};
   const again=readJson(lock);const beforeSignal=checked(owner,entry,configFile);
   if(again?.nonce!==owner.nonce||again?.pid!==owner.pid||beforeSignal?.birth!==info.birth)throw new Error('Service identity changed before stop; retry.');
   process.kill(owner.pid,'SIGTERM');
   const end=Date.now()+timeoutMs;
   while(Date.now()<end){const next=processInfo(owner.pid);if(!next||next.birth!==info.birth)return {state:'stopped',log};await delay(100);}
   throw new Error('Graceful stop timed out; no SIGKILL was sent. Check status and service.log.');
  }
  if(current.state!=='stopped')return current;
  const fd=fs.openSync(log,'a',0o600);let child,launchError;
  try{child=spawn('nohup',[process.execPath,entry,configFile],{cwd:path.dirname(path.dirname(defaultEntry)),detached:true,stdio:['ignore',fd,fd]});child.on('error',e=>{launchError=e;});child.unref();}finally{fs.closeSync(fd);}
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
   if(launchError)throw new Error('Could not launch nohup. Check its installation.');
   const state=status();if(state.state==='running')return state;
   if(child.exitCode!==null||child.signalCode!==null)throw new Error('Service exited during startup. Check '+log);
   await delay(100);
  }
  throw new Error('Startup readiness timed out. The process may still be starting; check status/log and use stop if needed.');
 }finally{release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length>4)throw new Error('Usage: service ACTION [CONFIG_FILE]');const r=await serviceCommand(process.argv[2],process.argv[3]);console.log(`${r.state}${r.pid?' PID '+r.pid:''}\nLog: ${r.log}`);}catch(e){console.error(e.message);process.exitCode=1;}
}
