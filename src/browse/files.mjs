import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {setImmediate as yieldNow} from 'node:timers/promises';
import {BotFiles} from '../files/paths.mjs';
import {zip} from './zip.mjs';

export const MAX_BYTES=32*1024*1024,MAX_ENTRIES=2000;
const fail=text=>{throw new Error(text);};
const languages={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',json:'json',yml:'yaml',yaml:'yaml',toml:'toml',sh:'bash',bash:'bash',ps1:'powershell',html:'html',htm:'html',css:'css',sql:'sql',xml:'xml',java:'java',kt:'kotlin',c:'c',h:'c',cpp:'cpp',hpp:'cpp',cs:'csharp',go:'go',rs:'rust',rb:'ruby',php:'php',md:'markdown',ini:'ini'};
const version=st=>[st.dev,st.ino,st.mode,st.size,st.mtimeMs,st.ctimeMs].join(':');
const nodeIdentity=st=>[st.dev,st.ino,st.mode].join(':');
const fileKey=p=>process.platform==='win32'?p.toLowerCase():p;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const join=(a,b)=>a==='.'?b:`${a}/${b}`;

export class BrowseFiles {
  constructor(root){this.store=new BotFiles(root,'browse',{admin:true});}
  normalize(input='.'){
    if(typeof input!=='string'||path.isAbsolute(input)||/[\x00-\x1f:]/.test(input))fail('Invalid file path.');
    const parts=this.store.parts(input);
    for(const part of parts)this.filename(part);
    return parts.join('/')||'.';
  }
  filename(name){
    if(typeof name!=='string'||!name||/[\\/<>:"|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))fail('Invalid file name.');
    this.store.parts(name);return name;
  }
  at(input,fn){
    const relative=this.normalize(input);
    return relative==='.'?fn(this.store.root):this.store.withParent(relative,false,filename=>{if(fs.lstatSync(filename,{throwIfNoEntry:false})?.isSymbolicLink())fail('Symlinks are not permitted.');return fn(filename);});
  }
  info(input){
    const relative=this.normalize(input);
    return this.at(relative,p=>{const st=fs.lstatSync(p);if(!st.isFile()&&!st.isDirectory())fail('Not a regular file or directory.');return {path:relative,name:relative==='.'?'Root':path.posix.basename(relative),directory:st.isDirectory(),size:st.size,mtime:st.mtime.toISOString(),version:version(st),identity:nodeIdentity(st)};});
  }
  initial(input='.'){
    const relative=this.normalize(input);
    try{return this.info(relative).directory?relative:'.';}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return '.';throw error;}
  }
  list(input){
    const relative=this.normalize(input);if(!this.info(relative).directory)fail('Not a directory.');
    const names=this.at(relative,p=>fs.readdirSync(p,{withFileTypes:true}));if(names.length>MAX_ENTRIES)fail(`Directory exceeds ${MAX_ENTRIES} entries.`);
    const entries=[];
    for(const entry of names){
      if(entry.isSymbolicLink())continue;
      const name=entry.name;
      try{this.filename(name);}catch{continue;}
      const child=join(relative,name);
      const item=this.at(child,p=>{const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isFile()&&!st.isDirectory())return null;return {path:child,name,directory:st.isDirectory(),size:st.size,mtime:st.mtime.toISOString(),version:version(st),identity:nodeIdentity(st)};});
      if(item)entries.push(item);
    }
    return entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||(a.name<b.name?-1:a.name>b.name?1:0));
  }
  read(input){const info=this.info(input);if(info.directory)fail('Not a regular file.');if(info.size>MAX_BYTES)fail('File exceeds the 32 MiB browse limit.');const bytes=this.store.read(this.normalize(input));if(this.info(input).version!==info.version)fail('File changed while being read.');return bytes;}
  preview(input){
    const info=this.info(input);if(info.directory||info.size>2048)return null;
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(this.read(input));}catch(error){if(error instanceof TypeError)return null;throw error;}
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))return null;
    const lines=text.replace(/\r\n?/g,'\n').split('\n');
    let language=languages[path.posix.extname(info.name).slice(1).toLowerCase()];
    if(!language&&/^#!.*\bpython[\d.]*\b/.test(text))language='python';
    if(!language&&/^#!.*\b(?:ba|z|k)?sh\b/.test(text))language='bash';
    return {text:lines.slice(0,50).join('\n'),truncated:lines.length>50,...(language?{language}:{})};
  }
  image(input){
    const info=this.info(input);if(info.directory||info.size>10*1024*1024)return null;
    const ext=path.posix.extname(info.name).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))return null;
    const bytes=this.read(input);
    const png=bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!png&&!jpeg&&!webp)return null;
    if(png&&(bytes.readUInt32BE(16)>10000||bytes.readUInt32BE(20)>10000||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>40000000))return null;
    return {bytes,filename:info.name,version:info.version};
  }
  async snapshot(input,{assert=()=>{}}={}){
    const result=[];let total=0;
    const visit=async p=>{
      assert();const item=this.info(p);total+=item.directory?0:item.size;
      if(result.length>=MAX_ENTRIES||total>MAX_BYTES)fail('Tree exceeds browse limits (2000 entries / 32 MiB).');
      result.push(item);if(item.directory)for(const child of this.list(p)){await yieldNow();await visit(child.path);}
    };
    await visit(this.normalize(input));return result;
  }
  async state(input,options){try{return await this.snapshot(input,options);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return [];throw error;}}
  parents(...inputs){
    const result={};
    for(let input of inputs){input=this.normalize(input);for(let p=path.posix.dirname(input);;p=path.posix.dirname(p)){try{result[fileKey(p)]=this.info(p).identity;}catch(error){if(error.code!=='ENOENT')throw error;}if(p==='.')break;}}
    return result;
  }
  checkParents(input,expected){for(let p=path.posix.dirname(input);;p=path.posix.dirname(p)){if(this.info(p).identity!==expected[fileKey(p)])fail('Parent directory changed.');if(p==='.')break;}}
  expect(input,expected){let current;try{current=this.info(input);}catch(error){if(error.code!=='ENOENT')throw error;}if((current?.version??null)!==(expected?.version??null))fail('Destination changed. Repeat the operation and confirm again.');}
  async planCopy(source,target,options){
    source=this.normalize(source);target=this.normalize(target);if(source==='.')fail('Copying the root is not supported.');
    const src=this.info(source),dest=this.info(target);
    if(src.identity===dest.identity)fail('Cannot copy an object into itself or its descendant.');
    if(src.directory){const relative=path.relative(this.at(source,p=>fs.realpathSync(p)),this.at(target,p=>fs.realpathSync(p)));if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))fail('Cannot copy an object into itself or its descendant.');}
    if(!dest.directory&&src.directory)fail('A directory cannot replace a file.');
    const destination=dest.directory?join(target,src.name):target;
    if(destination===source||src.directory&&destination.startsWith(source+'/'))fail('Cannot copy an object into itself or its descendant.');
    const sourceTree=await this.snapshot(source,options),destinationTree=await this.state(destination,options);
    const lookup=new Map(destinationTree.map(x=>[fileKey(x.path),x]));
    for(const item of sourceTree){const existing=lookup.get(fileKey(destination+item.path.slice(source.length)));if(existing&&existing.directory!==item.directory)fail('File/directory type conflict.');}
    const parents=this.parents(source,destination);
    return {kind:'copy',source,target,destination,sourceTree,destinationTree,parents,conflict:destinationTree.length>0,stamp:digest([sourceTree,destinationTree,parents])};
  }
  async planUpload(target,filename,bytes,options){
    if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES)fail('Upload exceeds the 32 MiB browse limit.');
    this.filename(filename);target=this.normalize(target);const info=this.info(target);
    const destination=info.directory?join(target,filename):target,destinationTree=await this.state(destination,options);
    if(destinationTree[0]?.directory)fail('File/directory type conflict.');
    const parents=this.parents(destination);
    return {kind:'upload',target,destination,bytes,destinationTree,parents,conflict:destinationTree.length>0,stamp:digest([destinationTree,parents])};
  }
  async planDelete(target,options){
    target=this.normalize(target);if(target==='.')fail('The root cannot be deleted.');
    const sourceTree=await this.snapshot(target,options);
    for(const item of sourceTree)if(item.directory){
      const all=this.at(item.path,p=>fs.readdirSync(p));
      if(all.length!==this.list(item.path).length)fail('Directory contains protected or unsupported entries; deletion is unavailable.');
    }
    const parents=this.parents(target);
    return {kind:'delete',source:target,sourceTree,parents,stamp:digest([sourceTree,parents]),conflict:true};
  }
  writeAtomic(input,bytes,expected){
    const relative=this.normalize(input);
    this.store.withParent(relative,false,destination=>{
      if(fs.lstatSync(destination,{throwIfNoEntry:false})?.isSymbolicLink())fail('Symlinks are not permitted.');
      const temporary=path.join(path.dirname(destination),'browse-write-'+randomBytes(12).toString('hex'));
      try{
        const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);}finally{fs.closeSync(fd);}
        this.expect(input,expected);
        // link is an atomic no-clobber installation when absence was confirmed.
        if(!expected)fs.linkSync(temporary,destination);else fs.renameSync(temporary,destination);
      }
      finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
    });
  }
  mkdir(input,expected){this.expect(input,expected);if(!expected)this.at(input,p=>fs.mkdirSync(p));}
  async apply(plan,{assert=()=>{}}={}){
    assert();
    const current=plan.kind==='copy'?await this.planCopy(plan.source,plan.target,{assert}):plan.kind==='delete'?await this.planDelete(plan.source,{assert}):await this.planUpload(plan.target,path.posix.basename(plan.destination),plan.bytes,{assert});
    if(current.stamp!==plan.stamp||current.destination!==plan.destination)fail('Source or destination changed. Repeat the operation and confirm again.');
    const parents={...plan.parents},destination=new Map((plan.destinationTree??[]).map(item=>[fileKey(item.path),item]));
    for(const item of [...(plan.sourceTree??[]),...(plan.destinationTree??[])])if(item.directory)parents[fileKey(item.path)]=item.identity;
    let copied=0;
    try{
      if(plan.kind==='delete'){
        // Never recursively rm a parent: hidden/new descendants were not part of
        // the confirmed accessible tree and must not be removed as a side effect.
        for(const item of [...plan.sourceTree].reverse()){
          assert();this.checkParents(item.path,parents);
          const current=this.info(item.path);if(item.directory?current.identity!==item.identity:current.version!==item.version)fail('Source changed.');
          this.at(item.path,p=>item.directory?fs.rmdirSync(p):fs.unlinkSync(p));copied++;await yieldNow();
        }
        return;
      }
      if(plan.kind==='upload'){assert();this.checkParents(plan.destination,parents);this.writeAtomic(plan.destination,plan.bytes,destination.get(fileKey(plan.destination)));return;}
      for(const item of plan.sourceTree){
        assert();this.checkParents(item.path,parents);if(this.info(item.path).version!==item.version)fail('Source changed.');
        const dest=plan.destination+item.path.slice(plan.source.length);
        this.checkParents(dest,parents);const expected=destination.get(fileKey(dest));
        if(item.directory){this.mkdir(dest,expected);parents[fileKey(dest)]=this.info(dest).identity;}else this.writeAtomic(dest,this.read(item.path),expected);copied++;
        await yieldNow();
      }
    }catch(error){if(copied)throw new Error(`Operation stopped after ${copied} entries: ${error.message}`);throw error;}
  }
  async archive(input,{assert=()=>{}}={}){
    const info=this.info(input);if(!info.directory)return {filename:info.name,bytes:this.read(input)};
    const tree=await this.snapshot(input,{assert}),entries=[];
    for(const item of tree.slice(1)){assert();if(this.info(item.path).version!==item.version)fail('Source changed.');const name=input==='.'?item.path:item.path.slice(input.length+1);entries.push({name:name+(item.directory?'/':''),mtime:item.mtime,...(item.directory?{}:{bytes:this.read(item.path)})});await yieldNow();}
    const bytes=await zip(entries);assert();return {filename:input==='.'?'files.zip':info.name+'.zip',bytes};
  }
}
