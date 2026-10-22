import {createInterface} from 'node:readline';
export function linuxOwner(child){
 let outcome,resolveReady,rejectReady,resolveStopped;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
 const stopped=new Promise(resolve=>{resolveStopped=resolve;});
 const lines=createInterface({input:child.stdio[4]});
 const unknown=()=>{if(outcome)return;outcome={state:'unknown',code:'process_ownership_unconfirmed'};rejectReady(Object.assign(Error('Linux process ownership unavailable.'),{code:'process_ownership_unavailable'}));resolveStopped(outcome);};
 lines.on('line',line=>{try{const value=JSON.parse(line);if(value.state==='ready')resolveReady();else if(value.state==='interrupted'){outcome={state:'interrupted'};resolveStopped(outcome);}else unknown();}catch{unknown();}});
 child.on('error',unknown);child.on('close',()=>{unknown();lines.close();});child.stdio[3].on('error',()=>{});
 return {ready,async stop(){if(outcome)return outcome;child.stdio[3].end('stop\n');let timer;try{return await Promise.race([stopped,new Promise(resolve=>{timer=setTimeout(()=>resolve({state:'unknown',code:'process_stop_unconfirmed'}),10000);})]);}finally{clearTimeout(timer);}},close(){child.stdio[3].end();}};
}
