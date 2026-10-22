import {ownWindowsJob} from './windows-owner.mjs';
// Linux ownership is established at spawn by RpcProcess's subreaper supervisor.
export async function ownProcessTree(pid,dataDir){
 if(process.platform==='win32')return ownWindowsJob(pid,dataDir);
 return {stop:async()=>({state:'unknown',code:'process_ownership_unavailable'}),close(){}};
}
