import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {websocketFiles} from '../../src/websocket/files.mjs';
test('WS files enforce agent temp boundaries and exclusive writes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-files-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const f=websocketFiles(root,{botId:'b',agentId:'a'},'w1');
 const p=f.write('packet.bin',Buffer.from([1,2,3]));assert.equal(f.size(),3);assert.throws(()=>f.write('packet.bin',Buffer.alloc(1)));assert.throws(()=>f.read('.temp/other/private'));assert.throws(()=>f.read('../private'));f.remove();assert.equal(f.exists(p),false);assert.equal(f.size(),0);
});
test('WS file operations never follow symlinks into external storage',{skip:process.platform==='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-links-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const external=path.join(root,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'keep'),'keep');const f=websocketFiles(root,{botId:'b',agentId:'a'},'w1');f.write('packet.bin',Buffer.from('a'));
 fs.symlinkSync(external,path.join(root,'b',f.dir,'link'));assert.equal(f.size(),1);assert.throws(()=>f.read(f.dir+'/link/keep'));f.remove();assert.equal(fs.readFileSync(path.join(external,'keep'),'utf8'),'keep');
 const parent=path.join(root,'b','.temp','a','websocket');fs.rmdirSync(parent);fs.symlinkSync(external,parent);assert.throws(()=>f.write('bad',Buffer.from('bad')));assert.equal(fs.existsSync(path.join(external,'w1')),false);
});
