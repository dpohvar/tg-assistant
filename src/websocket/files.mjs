import fs from 'node:fs';
import path from 'node:path';
import {BotFiles} from '../files/paths.mjs';
export function websocketFiles(botsDir, scope, connectionId) {
 const files=new BotFiles(path.join(botsDir,scope.botId),scope.agentId);
 const dir=`.temp/${scope.agentId}/websocket/${connectionId}`;
 const size=()=>{
  const scan=relative=>files.withParent(relative+'/placeholder',false,p=>{
   let total=0;for(const entry of fs.readdirSync(path.dirname(p),{withFileTypes:true})){
    const child=path.join(path.dirname(p),entry.name),st=fs.lstatSync(child);
    if(st.isSymbolicLink())continue;
    if(st.isDirectory())total+=scan(relative+'/'+entry.name);else if(st.isFile())total+=st.size;
   }return total;
  });
  try{return scan(dir);}catch(e){if(e.code==='ENOENT')return 0;throw e;}
 };
 return {dir,size,write(name,bytes){const p=dir+'/'+name;files.write(p,bytes,true);return p;},
  read:p=>files.read(p),exists(p){try{files.withParent(p,false,q=>{const st=fs.lstatSync(q);if(st.isSymbolicLink()||!st.isFile())throw Error('Invalid binary file');});return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}},
  remove(){try{files.remove(dir);}catch(e){if(e.code!=='ENOENT')throw e;}}};
}
