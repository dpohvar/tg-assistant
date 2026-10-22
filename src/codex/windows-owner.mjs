import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import readline from 'node:readline';
export async function ownWindowsJob(pid,dataDir){
 const dir=path.join(dataDir,'codex-owner');fs.mkdirSync(dir,{recursive:true});const source=fs.readFileSync(new URL('./windows-owner.cs',import.meta.url)),cs=path.join(dir,'owner.cs'),exe=path.join(dir,'owner.exe');
 if(!fs.existsSync(exe)||!fs.existsSync(cs)||!fs.readFileSync(cs).equals(source)){fs.writeFileSync(cs,source);execFileSync(path.join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/out:'+exe,cs],{windowsHide:true,timeout:20000,stdio:'pipe'});}
 const helper=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','ignore']}),lines=readline.createInterface({input:helper.stdout});let waiter,closed=false,stopping;
 const fail=()=>{closed=true;waiter?.reject(Error('Job control unavailable'));};helper.on('exit',fail);helper.on('error',fail);helper.stdin.on('error',fail);
 lines.on('line',line=>{const w=waiter;waiter=null;if(!w)return;try{w.resolve(JSON.parse(line));}catch{w.reject(Error('Invalid job evidence'));}});
 const call=line=>new Promise((resolve,reject)=>{if(closed)return reject(Error('Job owner closed'));const timer=setTimeout(()=>{waiter=null;reject(Error('Job owner timed out'));},10000);waiter={resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};helper.stdin.write(line+'\n');});
 const close=()=>{helper.stdin.end();};
 try{const evidence=await call('own '+pid);if(!evidence.owned)throw Error('Job ownership unavailable');return {
  stop(){return stopping??=(async()=>{try{return await call('stop');}catch{return {state:'unknown',code:'job_stop_unconfirmed'};}finally{close();}})();},
  close
 };}catch(e){close();throw e;}
}
