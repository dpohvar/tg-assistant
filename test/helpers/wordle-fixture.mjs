import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileWidget} from '../../src/widgets/build.mjs';
import {createRuntime} from '../../src/widgets/runtime.mjs';

export const WORDLE_ARCHIVE_SHA='f3279705d3873ed9588c6f2a88bf6e41a07ab4b8480865a4300238dc65a3d084';
export function sourceHashes(root){const out={};function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())visit(file);else if(item.isFile())out[path.relative(root,file)]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}visit(path.join(root,'widgets'));return out;}
export async function loadWordleFixture(t,archive) {
  if(createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==WORDLE_ARCHIVE_SHA)throw new Error('The approved Wordle archive hash does not match.');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wordle-contract-')),previous=process.cwd();let runtime;
  t.after(async()=>{await runtime?.close();process.chdir(previous);fs.rmSync(root,{recursive:true,force:true});});
  execFileSync('tar',['-xf',path.basename(archive),'-C',root],{cwd:path.dirname(path.resolve(archive)),windowsHide:true});
  const before=sourceHashes(root),assets=fileURLToPath(new URL('../../src/widgets',import.meta.url));
  const compiled=await compileWidget('widgets/wordle/widget.tsx',{cwd:root,agentId:'a',assets});
  const snapshot=path.join(root,'wordle-snapshot.mjs');fs.writeFileSync(snapshot,compiled.code);process.chdir(root);
  const module=await import(pathToFileURL(snapshot).href),ref={botId:'b',agentId:'a',widgetId:'wordle',generation:1},renders=[],answers=[];
  let state={inactivityMs:60000,notify:false};
  runtime=createRuntime({bridge:async(method,args)=>{
    if(method==='save'){state=structuredClone(args.state);return;}
    if(method==='views')return [{id:'view',target:{chatId:1,messageId:7},props:{}}];
    if(method==='publish'){renders.push(args.value);return;}
    if(method==='respond'){answers.push(args.answer);return;}
    if(method==='api'&&args.name==='user_roles')return {users:[{userId:1,role:'owner'}]};
    if(method==='notifyError')throw new Error('Wordle runtime error: '+JSON.stringify(args.error));
    if(method==='api'&&args.name==='notify_agent')return;
    throw new Error('Unexpected Wordle bridge '+method);
  }});
  await runtime.load(ref,{state,module,viewMode:true});await runtime.hook(ref,'onInit');
  return {root,module,runtime,ref,renders,answers,sourceHashesBefore:before,sourceHashesAfter:()=>sourceHashes(root),get initializedState(){return structuredClone(state);},
    async button(data,userId=1){const name=data.split(':')[0];await runtime.dispatch(ref,{name,source:'button',data:{id:'offline-'+data,data,from:{id:userId,first_name:'Fixture'}},receivedAt:new Date().toISOString(),delayed:false});return structuredClone(state);}};
}
