import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'browse-files-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const mod=await import('../../src/browse/files.mjs').catch(()=>({}));
  assert.equal(typeof mod.BrowseFiles,'function','BrowseFiles must implement scoped file operations');
  const files=new mod.BrowseFiles(root);
  const write=(name,text)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),text);};
  return {root,files,write};
}

test('browse directories default to root without masking forbidden paths and filter protected entries',async t=>{
  const {root,files,write}=await fixture(t);write('wiki/a.txt','a');write('.git/config','secret');write('.temp/one/file','temp');
  assert.equal(files.initial('missing'),'.');assert.equal(files.initial('wiki/a.txt'),'.');assert.equal(files.initial('wiki'),'wiki');
  assert.throws(()=>files.initial('../outside'));assert.throws(()=>files.initial('.git'));
  assert.deepEqual(files.list('.').map(x=>x.name),['.temp','wiki']);
  try{fs.symlinkSync(path.join(root,'wiki'),path.join(root,'link'),'junction');}catch(error){if(error.code==='EPERM')return;throw error;}
  assert.equal(files.list('.').some(x=>x.name==='link'),false);assert.throws(()=>files.info('link/a.txt'));
});

test('text preview respects whole-file byte limit and fifty logical lines with literal pre content',async t=>{
  const {files,write}=await fixture(t);
  write('edge.py','x'.repeat(2048));assert.equal(files.preview('edge.py').text.length,2048);assert.equal(files.preview('edge.py').language,'python');
  write('large.py','x'.repeat(2049));assert.equal(files.preview('large.py'),null);
  write('many.js',Array.from({length:60},(_,i)=>`// ${i}`).join('\r\n'));
  const preview=files.preview('many.js');assert.equal(preview.text.split('\n').length,50);assert.equal(preview.truncated,true);assert.equal(preview.language,'javascript');
  write('literal.txt','<script>&hello');assert.equal(files.preview('literal.txt').text,'<script>&hello');
  write('binary.txt',Buffer.from([0,1,255]));assert.equal(files.preview('binary.txt'),null);
});

test('copy plans confirm conflicts, merge directories and preserve unrelated destination files',async t=>{
  const {files,write,root}=await fixture(t);
  write('source/a.txt','new');write('source/sub/b.txt','b');write('target/source/a.txt','old');write('target/source/keep.txt','keep');
  const plan=await files.planCopy('source','target');assert.equal(plan.conflict,true);
  assert.equal(fs.readFileSync(path.join(root,'target/source/a.txt'),'utf8'),'old');
  await files.apply(plan);
  assert.equal(fs.readFileSync(path.join(root,'target/source/a.txt'),'utf8'),'new');
  assert.equal(fs.readFileSync(path.join(root,'target/source/keep.txt'),'utf8'),'keep');
  assert.equal(fs.readFileSync(path.join(root,'target/source/sub/b.txt'),'utf8'),'b');
  write('target/file.txt','replace me');const replacement=await files.planCopy('source/a.txt','target/file.txt');assert.equal(replacement.conflict,true);await files.apply(replacement);
  assert.equal(fs.readFileSync(path.join(root,'target/file.txt'),'utf8'),'new');
  await assert.rejects(files.planCopy('source','target/file.txt'));
  await assert.rejects(files.planCopy('source','source/sub'));
  await assert.rejects(files.planCopy('source/a.txt','source/a.txt'));
});

test('confirmation plans reject changed sources and destinations before mutation',async t=>{
  const {files,write,root}=await fixture(t);write('a.txt','source');write('b.txt','old');
  const plan=await files.planCopy('a.txt','b.txt');write('b.txt','changed destination');await assert.rejects(files.apply(plan),/changed/i);
  assert.equal(fs.readFileSync(path.join(root,'b.txt'),'utf8'),'changed destination');
  const plan2=await files.planCopy('a.txt','b.txt');write('a.txt','changed source');await assert.rejects(files.apply(plan2),/changed/i);
});

test('upload uses one validated filename for a directory and exact selected file for replacement',async t=>{
  const {files,write,root}=await fixture(t);write('wiki/selected.txt','old');
  const p=await files.planUpload('wiki','hello.txt',Buffer.from('hello'));assert.equal(p.conflict,false);await files.apply(p);
  const replace=await files.planUpload('wiki/selected.txt','different.txt',Buffer.from('new'));assert.equal(replace.conflict,true);await files.apply(replace);
  assert.equal(fs.readFileSync(path.join(root,'wiki/selected.txt'),'utf8'),'new');assert.equal(fs.existsSync(path.join(root,'wiki/different.txt')),false);
  for(const filename of ['../bad','a/b','a\\b','.git','C:bad','name:stream','CON','trailing.'])await assert.rejects(files.planUpload('wiki',filename,Buffer.from('bad')));
});

test('ZIP download contains readable relative entries and empty directories but no protected files',async t=>{
  const {files,write,root}=await fixture(t);write('wiki/a.txt','archive data');write('wiki/.git/config','secret');fs.mkdirSync(path.join(root,'wiki/empty'));
  const {bytes,filename}=await files.archive('wiki');assert.equal(filename,'wiki.zip');
  const extracted=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    const method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString();const start=offset+30+nameLength+extraLength;
    const data=bytes.subarray(start,start+size);extracted.set(name,method===8?inflateRawSync(data).toString():data.toString());offset=start+size;
  }
  assert.equal(extracted.get('a.txt'),'archive data');assert.equal(extracted.has('empty/'),true);assert.equal([...extracted.keys()].some(x=>x.includes('.git')),false);
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);
});

test('deleting a directory cannot bypass protected descendants excluded from its listing',async t=>{
  const {files,write,root}=await fixture(t);write('wiki/a.txt','visible');write('wiki/.git/config','protected');
  try{const plan=await files.planDelete('wiki');await files.apply(plan);}catch(error){assert.match(error.message,/protected|unsupported/i);}
  assert.equal(fs.readFileSync(path.join(root,'wiki/.git/config'),'utf8'),'protected');
});

test('a destination created after copy preparation cannot be overwritten without new confirmation',async t=>{
  const {files,write,root}=await fixture(t);write('source/a.txt','source');fs.mkdirSync(path.join(root,'target'));
  const plan=await files.planCopy('source','target');assert.equal(plan.conflict,false);
  const mkdir=files.mkdir.bind(files);files.mkdir=(...args)=>{mkdir(...args);write('target/source/a.txt','concurrent content');};
  await assert.rejects(files.apply(plan),/changed|exist|conflict/i);assert.equal(fs.readFileSync(path.join(root,'target/source/a.txt'),'utf8'),'concurrent content');
});

test('case aliases cannot copy a directory into its descendant on Windows',async t=>{
  if(process.platform!=='win32'){t.skip('Windows filesystem aliases');return;}
  const {files,write}=await fixture(t);write('Source/a.txt','a');await assert.rejects(files.planCopy('Source','source'),/itself|descendant/i);
});

test('a source file replaced after delete preparation is preserved',async t=>{
  const {files,write,root}=await fixture(t);write('wiki/a.txt','a');write('wiki/b.txt','b');
  const plan=await files.planDelete('wiki'),at=files.at.bind(files);let mutated=false;
  files.at=(input,fn)=>{const result=at(input,fn);if(input==='wiki/b.txt'&&!mutated&&!fs.existsSync(path.join(root,'wiki/b.txt'))){mutated=true;write('wiki/a.txt','new unrelated content');}return result;};
  await assert.rejects(files.apply(plan),/changed/i);assert.equal(fs.readFileSync(path.join(root,'wiki/a.txt'),'utf8'),'new unrelated content');
});
