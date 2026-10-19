import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createCommands} from '../../src/commands/router.mjs';
import {createFileCommands} from '../../src/commands/files.mjs';

function fixture(t,{type='supergroup',ephemeral=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'group-files-')),db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});for(const [id,role] of [[2,'admin'],[3,'manager'],[4,'user']])db.setRole('b',id,role);
  const config={botsDir:path.join(root,'bots'),dataDir:path.join(root,'data')},botRoot=path.join(config.botsDir,'b'),rulesRoot=path.join(config.dataDir,'rules','b');
  fs.mkdirSync(path.join(botRoot,'wiki'),{recursive:true});fs.mkdirSync(rulesRoot,{recursive:true});
  fs.writeFileSync(path.join(botRoot,'wiki','source.txt'),'hello <world>');fs.writeFileSync(path.join(rulesRoot,'AGENTS.md'),'Shared rules');
  const chat={id:-100,type,...(type==='supergroup'?{is_forum:true}:{})},calls=[];let id=100;
  const telegram={call:async(bot,method,args,options)=>{calls.push({bot,method,args,options});return {message_id:ephemeral?0:++id,...(ephemeral?{ephemeral_message_id:++id,receiver_user:{id:args.ephemeral_message_parameters?.receiver_user_id}}:{}),date:100,chat,from:{id:42,is_bot:true},text:args.text};}};
  const fileCommands=createFileCommands({db,config,telegram,fetchDocument:async()=>Buffer.from('uploaded')});
  const rulesWrites=[],router=createCommands({db,config,clock:()=>100000,telegram,fileCommands,updateRules:async(...args)=>rulesWrites.push(args)});
  t.after(()=>{router.close();db.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
  const send=(text,{userId=2,entities}={})=>router.handle('b',{message_id:ephemeral?0:++id,...(ephemeral?{ephemeral_message_id:++id,receiver_user:{id:42}}:{}),date:100,chat,from:{id:userId},text,entities,...(chat.is_forum?{message_thread_id:7,is_topic_message:true}:{})});
  return {send,calls,botRoot,config,rulesWrites};
}

for(const type of ['group','supergroup'])test(`admin file commands perform real operations with private replies in ${type}`,async t=>{
  const f=fixture(t,{type});await f.send('/ls wiki');assert.match(f.calls.at(-1).args.text,/source.txt/);
  await f.send('/cat wiki/source.txt');assert.equal(f.calls.at(-1).args.text,'wiki/source.txt\n<pre>hello &lt;world&gt;</pre>');assert.equal(f.calls.at(-1).args.parse_mode,'HTML');
  const text='/edit wiki/new.txt new content';await f.send(text,{entities:[{type:'pre',offset:19,length:11}]});assert.equal(fs.readFileSync(path.join(f.botRoot,'wiki/new.txt'),'utf8'),'new content');
  await f.send('/mv wiki/new.txt wiki/moved.txt');assert.equal(fs.existsSync(path.join(f.botRoot,'wiki/new.txt')),false);assert.equal(fs.readFileSync(path.join(f.botRoot,'wiki/moved.txt'),'utf8'),'new content');
  await f.send('/rm wiki/moved.txt');assert.equal(fs.existsSync(path.join(f.botRoot,'wiki/moved.txt')),false);
  assert.ok(f.calls.every(c=>c.args.ephemeral_message_parameters?.receiver_user_id===2));
});

test('group download and rules return native private documents in the invoking topic',async t=>{
  const f=fixture(t);await f.send('/download wiki/source.txt');await f.send('/rules');
  assert.deepEqual(f.calls.map(c=>c.method),['sendDocument','sendDocument']);
  assert.deepEqual(f.calls.map(c=>c.options.uploads[0].bytes.toString()),['hello <world>','Shared rules']);
  assert.deepEqual(f.calls.map(c=>c.options.uploads[0].filename),['source.txt','AGENTS.md']);
  for(const call of f.calls){assert.equal(call.args.chat_id,-100);assert.equal(call.args.message_thread_id,7);assert.equal(call.args.ephemeral_message_parameters.receiver_user_id,2);assert.ok(call.args.reply_parameters.ephemeral_message_id);assert.equal(call.args.reply_parameters.message_id,undefined);}
});

test('expanded group file operations preserve ordinary response routing',async t=>{
  const f=fixture(t,{ephemeral:false});await f.send('/download wiki/source.txt');await f.send('/rules');
  assert.deepEqual(f.calls.map(c=>c.method),['sendDocument','sendDocument']);
  for(const call of f.calls){assert.equal(call.args.ephemeral_message_parameters,undefined);assert.equal(call.args.message_thread_id,7);assert.ok(call.args.reply_parameters.message_id);}
});

test('group file and rules operations still require the current application admin role',async t=>{
  const f=fixture(t);
  for(const userId of [3,4,5])for(const text of ['/cat wiki/source.txt','/download wiki/source.txt','/rm wiki/source.txt','/rules'])await f.send(text,{userId});
  assert.equal(fs.readFileSync(path.join(f.botRoot,'wiki/source.txt'),'utf8'),'hello <world>');assert.ok(f.calls.every(c=>c.method==='sendMessage'));assert.ok(f.calls.every(c=>/Access denied/.test(c.args.text)));
});

test('group file scope still rejects traversal and protected paths',async t=>{
  const f=fixture(t);await f.send('/cat ../outside.txt');await f.send('/rm .git/config');
  assert.ok(f.calls.every(c=>/Command failed/.test(c.args.text)));assert.equal(fs.existsSync(path.join(f.botRoot,'wiki/source.txt')),true);
});

test('group help aliases return the full file section through the private response route',async t=>{
  const f=fixture(t);await f.send('/help download');const text=f.calls.map(c=>c.args.text).join('\n');
  assert.match(text,/\/ls \[PATH\]/);assert.match(text,/\/download PATH/);assert.match(text,/\/rm PATH/);assert.ok(f.calls.every(c=>c.args.ephemeral_message_parameters.receiver_user_id===2));
});
