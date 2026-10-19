import fs from 'node:fs';
import path from 'node:path';
// One receipt per explicit attempt. These are confirmations, never request locks.
export function createGuestReceipts({directory,now=Date.now}={}) {
  const memory=new Map(),valid=id=>typeof id==='string'&&/^gp[a-f0-9]{32}$/.test(id);
  const filename=id=>{if(!valid(id))throw new Error('Invalid guest publication receipt identity.');return path.join(directory,id+'.json');};
  const api={
    write(receipt) {
      if(!valid(receipt.publicationId))throw new Error('Invalid guest publication receipt identity.');
      if(!directory){memory.set(receipt.publicationId,structuredClone(receipt));return;}
      fs.mkdirSync(directory,{recursive:true});const file=filename(receipt.publicationId);
      fs.writeFileSync(file+'.tmp',JSON.stringify(receipt),{mode:0o600});fs.renameSync(file+'.tmp',file);
    },
    done(id) {
      if(!directory){memory.delete(id);return;}
      try{fs.unlinkSync(filename(id));}catch(error){if(error.code!=='ENOENT')throw error;}
    },
    list() {
      if(!directory)return [...memory.values()].map(x=>structuredClone(x));
      if(!fs.existsSync(directory))return [];
      return fs.readdirSync(directory).filter(name=>/^gp[a-f0-9]{32}\.json$/.test(name)).map(name=>{
        try{return JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));}
        catch{throw new Error('A guest publication receipt is unreadable; inspect the private data directory.');}
      });
    },
    cleanup(at=now()) {for(const receipt of api.list())if(receipt.expiresAt<=at)api.done(receipt.publicationId);},
  };return api;
}
