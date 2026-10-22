import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {openDatabase} from '../../src/storage/database.mjs';
import {fixturePNG} from '../manual/inline-fixtures.mjs';

export async function fixture(t,{ephemeral=true,fetchDocument=async()=>Buffer.from('uploaded')}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'browse-service-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.setRole('b',2,'admin');db.setRole('b',3,'user');
  const config={botsDir:path.join(root,'bots'),dataDir:path.join(root,'data')},botRoot=path.join(config.botsDir,'b');
  fs.mkdirSync(path.join(botRoot,'wiki'),{recursive:true});fs.writeFileSync(path.join(botRoot,'wiki','a.py'),'print("hello")');
  fs.writeFileSync(path.join(botRoot,'wiki','b.txt'),'second');fs.mkdirSync(path.join(botRoot,'target'));
  const chat={id:ephemeral?-100:2,type:ephemeral?'supergroup':'private'},calls=[];let next=100,time=100000;
  const message=(text='/browse',user=2)=>({message_id:ephemeral?0:++next,...(ephemeral?{ephemeral_message_id:++next,receiver_user:{id:42}}:{}),date:Math.floor(time/1000),chat,from:{id:user},text});
  let current,fail;
  const telegram={call:async(bot,method,args,options)=>{
    calls.push({bot,method,args,options});if(fail)throw fail;
    if(method==='sendRichMessage')current={message_id:ephemeral?0:++next,...(ephemeral?{ephemeral_message_id:++next,receiver_user:{id:args.ephemeral_message_parameters?.receiver_user_id}}:{}),date:Math.floor(time/1000),chat:args.chat_id===chat.id?chat:{id:args.chat_id,type:'supergroup'},from:{id:42,is_bot:true},rich_message:structuredClone(args.rich_message)};
    if(method==='editEphemeralMessageText'||method==='editMessageText')current={...current,rich_message:structuredClone(args.rich_message)};
    if(method==='sendMessage'){const result={message_id:ephemeral?0:++next,...(ephemeral?{ephemeral_message_id:++next,receiver_user:{id:args.ephemeral_message_parameters?.receiver_user_id}}:{}),date:Math.floor(time/1000),chat,from:{id:42,is_bot:true},text:args.text};calls.at(-1).response=result;return result;}
    return method==='sendRichMessage'||method==='editMessageText'?structuredClone(current):true;
  }};
  const mod=await import('../../src/browse/service.mjs').catch(()=>({}));assert.equal(typeof mod.createBrowse,'function','createBrowse must own controller sessions');
  const service=mod.createBrowse({db,config,telegram,fetchDocument,now:()=>time});
  const buttons=()=>{const result=[];const walk=v=>{if(!v||typeof v!=='object')return;if(v.callback_data)result.push(v);Object.values(v).forEach(walk);};walk(current.rich_message);return result;};
  const click=async(label,{user=2,data,view}={})=>{const button=buttons().find(b=>String(b.text).includes(label));assert(button||data,`missing button: ${label}`);return service.callback('b',{id:'cb-'+(++next),from:{id:user},data:data??button.callback_data,message:structuredClone(view??current)});};
  t.after(async()=>{service.close();await service.idle();db.close();fs.rmSync(root,{recursive:true,force:true});});
  return {service,db,config,botRoot,calls,message,click,buttons,telegram,get current(){return current;},setCurrent:v=>{current=v;},advance:ms=>{time+=ms;},reject:error=>{fail=error;}};
}

test('rich browse navigates from breadcrumbs to file information and pre without an agent',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'.');await f.click('wiki');await f.click('a.py');
  const pre=f.current.rich_message.blocks.find(b=>b.type==='pre');assert.equal(pre.text,'print("hello")');assert.equal(pre.language,'python');
  assert.match(JSON.stringify(f.current.rich_message),/Modified:/);assert.equal(f.current.rich_message.blocks.some(b=>b.type==='document'),false);
  await f.click('Root');assert(f.buttons().some(b=>b.text.includes('wiki')));
});

test('download embeds a document, learns observed IDs for redraws and explicitly downloads fresh bytes again',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'wiki');await f.click('a.py');await f.click('Download');
  let doc=f.current.rich_message.blocks.find(b=>b.type==='document');assert.match(doc.document.media,/^attach:\/\//);
  const first=f.calls.filter(c=>c.options?.uploads?.length).at(-1);assert.equal(first.options.uploads.at(-1).bytes.toString(),'print("hello")');
  doc.document={file_id:'known-document-id',file_unique_id:'unique',file_name:'a.py',file_size:14};
  await f.click('🔄');doc=f.current.rich_message.blocks.find(b=>b.type==='document');assert.equal(doc.document.media,'known-document-id');
  assert.equal(f.calls.at(-1).options?.uploads?.length??0,0);
  fs.writeFileSync(path.join(f.botRoot,'wiki','a.py'),'fresh');await f.click('Download');
  assert.equal(f.calls.filter(c=>c.options?.uploads?.length).at(-1).options.uploads.at(-1).bytes.toString(),'fresh');
});

test('copy and paste require confirmation and preserve directory merge contents',async t=>{
  const f=await fixture(t);fs.mkdirSync(path.join(f.botRoot,'target','wiki'));fs.writeFileSync(path.join(f.botRoot,'target','wiki','a.py'),'old');
  await f.service.open('b',f.message(),'wiki');await f.click('Copy');await f.click('Root');await f.click('target');await f.click('Paste');
  assert.equal(fs.readFileSync(path.join(f.botRoot,'target/wiki/a.py'),'utf8'),'old');assert(f.buttons().some(b=>b.text==='Confirm'));
  await f.click('Confirm');assert.equal(fs.readFileSync(path.join(f.botRoot,'target/wiki/a.py'),'utf8'),'print("hello")');
  await f.click('wiki');await f.click('b.txt');await f.click('Delete');assert.equal(fs.existsSync(path.join(f.botRoot,'target/wiki/b.txt')),true);await f.click('Cancel');assert.equal(fs.existsSync(path.join(f.botRoot,'target/wiki/b.txt')),true);
});

test('one browse per bot/user transfers clipboard and rejects previous-message and foreign-user callbacks',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'wiki');await f.click('a.py');await f.click('Copy');
  const old=f.current,data=f.buttons().find(b=>b.text==='Delete').callback_data;
  await f.service.open('b',f.message(),'target');assert(f.calls.some(c=>c.method==='deleteEphemeralMessage'&&c.args.ephemeral_message_id===old.ephemeral_message_id));
  assert.match(JSON.stringify(f.current.rich_message),/Clipboard: 📄 wiki\/a.py/);
  await f.click('',{data,view:old});assert.equal(fs.existsSync(path.join(f.botRoot,'wiki/a.py')),true);
  const before=JSON.stringify(f.current);await f.click('Paste',{user:3});assert.equal(JSON.stringify(f.current),before);
  f.db.setRole('b',2,'user');await f.click('Paste');assert.equal(fs.existsSync(path.join(f.botRoot,'target/a.py')),false);
});

test('upload invitation binds its exact destination and overwriting selected files is confirmed',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'wiki');await f.click('a.py');await f.click('Upload');
  const sent=f.calls.findLast(c=>c.method==='sendMessage'),invitation=sent.response;
  assert(sent.args.ephemeral_message_parameters.callback_query_id);
  await f.click('Root');
  const reply={...f.message(),document:{file_id:'upload-id',file_name:'different.txt',file_size:8},reply_to_message:invitation};
  assert.equal(await f.service.upload('b',{...reply,reply_to_message:{...invitation,ephemeral_message_id:9999}}),false);
  assert.equal(await f.service.upload('b',reply),true);assert.equal(fs.readFileSync(path.join(f.botRoot,'wiki/a.py'),'utf8'),'print("hello")');
  assert(f.buttons().some(b=>b.text==='Confirm'));await f.click('Confirm');assert.equal(fs.readFileSync(path.join(f.botRoot,'wiki/a.py'),'utf8'),'uploaded');
  assert.equal(fs.existsSync(path.join(f.botRoot,'wiki/different.txt')),false);
});

test('directory pagination and expiration do not accept a stale revision',async t=>{
  const f=await fixture(t);for(let i=0;i<12;i++)fs.writeFileSync(path.join(f.botRoot,'target',`file-${i}.txt`),'x');
  await f.service.open('b',f.message(),'target');assert(f.buttons().some(b=>b.text==='➡️'));
  const old=f.current,data=f.buttons().find(b=>b.text.includes('file-0.txt')).callback_data;await f.click('➡️');await f.click('',{data,view:old});
  assert.equal(f.current.rich_message.blocks.some(b=>b.type==='pre'),false);
  f.advance(3600001);await f.click('🔄');assert.match(f.calls.findLast(c=>c.method==='answerCallbackQuery').args.text,/expired/i);
});

test('a new browse during an admitted upload transfers busy status and retains the original destination',async t=>{
  let release,entered;const waiting=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const f=await fixture(t,{fetchDocument:async()=>{entered();await waiting;return Buffer.from('late');}});
  await f.service.open('b',f.message(),'wiki');await f.click('Upload');const invitation=f.calls.findLast(c=>c.method==='sendMessage').response;
  const job=f.service.upload('b',{...f.message(),document:{file_id:'late',file_name:'late.txt',file_size:4},reply_to_message:invitation});
  await started;await f.service.open('b',f.message(),'target');assert.match(JSON.stringify(f.current.rich_message),/Receiving upload/);assert.equal(f.buttons().length,0);
  release();await job;assert.equal(fs.readFileSync(path.join(f.botRoot,'wiki/late.txt'),'utf8'),'late');assert.equal(fs.existsSync(path.join(f.botRoot,'target/late.txt')),false);assert(f.buttons().some(b=>b.text==='Upload'));
});

test('unknown delivery cannot automatically replay a mutation or switch to public output',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'wiki');
  f.reject(Object.assign(new Error('transport failed'),{code:'telegram_transport_failed'}));await f.click('Download');
  const sends=f.calls.filter(c=>c.method.startsWith('send')).length;await f.service.callback('b',{id:'stale',from:{id:2},data:'br:unknown:1:0',message:f.current});
  assert.equal(f.calls.filter(c=>c.method.startsWith('send')).length,sends);
  assert(f.calls.filter(c=>c.method.startsWith('send')).every(c=>c.args.ephemeral_message_parameters));
});

test('a callback waiting for acknowledgement cannot act on a replacement browse',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'wiki');await f.click('a.py');
  const call=f.telegram.call;let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  f.telegram.call=async(...args)=>{if(args[1]==='answerCallbackQuery'){entered();await waiting;}return call(...args);};
  const click=f.click('Delete');await started;await f.service.open('b',f.message(),'target');release();await click;
  assert.equal(f.buttons().some(b=>b.text==='Confirm'),false);assert.equal(fs.existsSync(path.join(f.botRoot,'wiki/a.py')),true);
});

test('a partially failed merge invalidates the previous directory attachment',async t=>{
  const f=await fixture(t);fs.mkdirSync(path.join(f.botRoot,'target/wiki'));fs.writeFileSync(path.join(f.botRoot,'target/wiki/a.py'),'old');fs.writeFileSync(path.join(f.botRoot,'target/wiki/b.txt'),'old');
  await f.service.open('b',f.message(),'wiki');await f.click('Copy');await f.click('Root');await f.click('target');await f.click('Download');await f.click('Paste');
  const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to.endsWith('b.txt'))throw Object.assign(new Error('Simulated disk error'),{code:'EACCES'});return rename(from,to);};
  try{await f.click('Confirm');}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(path.join(f.botRoot,'target/wiki/a.py'),'utf8'),'print("hello")');
  assert.equal(f.current.rich_message.blocks.some(b=>b.type==='document'),false);assert.match(JSON.stringify(f.current.rich_message),/Failed/);
});

test('known Telegram image rejection falls back to file information and keeps Download usable',async t=>{
  const f=await fixture(t);fs.writeFileSync(path.join(f.botRoot,'wiki/image.png'),fixturePNG());
  const call=f.telegram.call;f.telegram.call=async(...args)=>{if(args[2]?.rich_message?.blocks.some(b=>b.type==='photo'))throw Object.assign(new Error('Bad Request: IMAGE_PROCESS_FAILED'),{code:'telegram_api_error'});return call(...args);};
  await f.service.open('b',f.message(),'wiki');await f.click('image.png');
  assert(f.buttons().some(b=>b.text==='Download'));assert.equal(f.current.rich_message.blocks.some(b=>b.type==='photo'),false);
  await f.click('Download');assert(f.current.rich_message.blocks.some(b=>b.type==='document'));
});

test('directory navigation keeps five centered controls at every pagination boundary',async t=>{
  const f=await fixture(t);for(let i=0;i<33;i++)fs.writeFileSync(path.join(f.botRoot,'target',`${String(i).padStart(2,'0')}.txt`),'x');
  const panel=()=>f.current.rich_message.blocks.find(b=>b.type==='buttons');
  await f.service.open('b',f.message(),'target');
  assert.deepEqual(panel().buttons.map(b=>b.text),['⬆️','⬅️','1-10/33','➡️','🔄']);assert.equal(panel().align,'center');
  assert(panel().buttons[1].disabled);assert(panel().buttons[2].disabled);assert(panel().buttons[0].callback_data);assert(panel().buttons[3].callback_data);
  await f.click('➡️');assert.deepEqual(panel().buttons.map(b=>b.text),['⬆️','⬅️','11-20/33','➡️','🔄']);assert(panel().buttons[1].callback_data);
  await f.click('➡️');await f.click('➡️');assert.deepEqual(panel().buttons.map(b=>b.text),['⬆️','⬅️','31-33/33','➡️','🔄']);assert(panel().buttons[3].disabled);
  await f.click('⬆️');assert.equal(panel().buttons.length,5);assert(panel().buttons[0].disabled);
  assert(f.current.rich_message.blocks.filter(b=>b.type==='buttons').every(b=>b.align==='center'));
});

test('empty directories keep all navigation positions and file views have only up and refresh',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'target');
  let panel=f.current.rich_message.blocks.find(b=>b.type==='buttons');assert.deepEqual(panel.buttons.map(b=>b.text),['⬆️','⬅️','0-0/0','➡️','🔄']);assert(panel.buttons[1].disabled);assert(panel.buttons[3].disabled);
  await f.click('⬆️');await f.click('wiki');await f.click('a.py');
  panel=f.current.rich_message.blocks.find(b=>b.type==='buttons');assert.deepEqual(panel.buttons.map(b=>b.text),['⬆️','🔄']);assert.equal(panel.align,'center');
  await f.click('⬆️');assert(f.buttons().some(b=>b.text.includes('a.py')));
});

test('parent entry is first on every directory page and does not affect pagination totals',async t=>{
  const f=await fixture(t);for(let i=0;i<11;i++)fs.writeFileSync(path.join(f.botRoot,'target',`${i}.txt`),'x');
  const parent=()=>f.current.rich_message.blocks[2];
  await f.service.open('b',f.message(),'target');
  assert.equal(parent().type,'paragraph');assert.equal(parent().text[0].button.text,'📁 ..');
  const firstFile=f.current.rich_message.blocks.find(b=>b.type==='paragraph'&&Array.isArray(b.text)&&b.text[0]?.button?.text==='📄 0.txt');
  assert(firstFile,'the file icon and name must share the same callback button');
  assert(f.current.rich_message.blocks.find(b=>b.type==='buttons').buttons.some(b=>b.text==='1-10/11'));
  await f.click('➡️');assert.equal(parent().text[0].button.text,'📁 ..');
  assert(f.current.rich_message.blocks.find(b=>b.type==='buttons').buttons.some(b=>b.text==='11-11/11'));
  await f.click('..');assert.equal(f.current.rich_message.blocks.some(b=>b.text?.[0]?.button?.text==='📁 ..'),false);
  await f.click('wiki');await f.click('a.py');assert.equal(f.buttons().some(b=>b.text.includes('..')),false);
});

test('breadcrumbs include directory and file icons inside their own segments',async t=>{
  const f=await fixture(t);await f.service.open('b',f.message(),'wiki');
  let crumbs=f.current.rich_message.blocks[0].text;
  assert.equal(crumbs[0].button.text,'📁 Root');assert.equal(crumbs[2],'📁 wiki');
  await f.click('a.py');crumbs=f.current.rich_message.blocks[0].text;
  assert.equal(crumbs[0].button.text,'📁 Root');assert.equal(crumbs[2].button.text,'📁 wiki');assert.equal(crumbs[4],'📄 a.py');
  await f.click('Root');assert.equal(f.current.rich_message.blocks.some(b=>b.text?.[0]?.button?.text==='📁 ..'),false);
});
