import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { retention } from '../../src/storage/retention.mjs';

test('generated-source cleanup refuses registered paths outside protected image storage', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-retention-')), db = openDatabase(path.join(root, 'db.sqlite'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 });
  const file = path.join(root, 'important'), notices = [];
  fs.writeFileSync(file, 'keep'); fs.utimesSync(file, new Date(0), new Date(0));
  db.sql.prepare('INSERT INTO generated_images VALUES(?,?,?,?)').run(file, 'b', 'a', 'thread');
  await retention({ db, config: { botsDir: path.join(root, 'bots'), codexHome: path.join(root, 'protected') }, telegram: { call: async (_bot, _method, args) => notices.push(args) }, now: 100 * 86400000 });
  assert.equal(fs.existsSync(file), true);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generated_images').get().n, 1);
  assert.equal(notices.length, 1); assert.equal(notices[0].chat_id, 1);
});

test('daily retention respects age boundaries and preserves wiki, notes and pending/processing tasks',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-retention-age-')),db=openDatabase(path.join(root,'db.sqlite'));t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const day=86400000,now=Date.now(),wiki=path.join(root,'bots','b');fs.mkdirSync(path.join(wiki,'.temp','a'),{recursive:true});
 db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});db.saveChat('b',{id:1,type:'private'});const agent=db.ensureAgent('b',1);db.sql.prepare('UPDATE agents SET notes=? WHERE agentId=?').run('Persistent notes',agent.agentId);
 for(const [id,age] of [[1,30*day+1],[2,30*day],[3,day]]){db.saveMessage('b',{message_id:id,date:1,chat:{id:1,type:'private'},text:'old Telegram date'},now-age);db.sql.prepare('INSERT INTO button_state VALUES(?,?,?,?,?)').run('b',1,id,'{}','[]');}
 for(const [id,age] of [[1,7*day+1],[2,7*day],[3,day]])db.sql.prepare('INSERT INTO agent_messages VALUES(?,?,?,?,?,?)').run(id,'b',agent.agentId,agent.agentId,now-age,'Message');
 for(const state of ['pending','processing']){db.sql.prepare('INSERT INTO tasks(taskId,agentId,description,text,at,createdAt) VALUES(?,?,?,?,?,?)').run(state,agent.agentId,'Keep task','Instruction','2000-01-01T00:00:00Z',0);db.sql.prepare('INSERT INTO task_firings VALUES(?,?,?,?,?,?)').run(state,state,0,0,3,1);}
 const make=(relative,age)=>{const f=path.join(wiki,relative);fs.writeFileSync(f,'keep or expire');fs.utimesSync(f,new Date(now-age),new Date(now-age));return f;};
 const old=make('.temp/a/old',day+1000),boundary=make('.temp/a/boundary',day),fresh=make('.temp/a/fresh',1000),permanent=make('knowledge.md',90*day);
 const images=path.join(root,'protected','generated_images','thread');fs.mkdirSync(images,{recursive:true});
 for(const [name,age] of [['old.png',day+1000],['fresh.png',1000]]){const f=path.join(images,name);fs.writeFileSync(f,'image');fs.utimesSync(f,new Date(now-age),new Date(now-age));db.sql.prepare('INSERT INTO generated_images VALUES(?,?,?,?)').run(f,'b',agent.agentId,'thread');}
 const notices=[];await retention({db,config:{botsDir:path.join(root,'bots'),codexHome:path.join(root,'protected')},now,telegram:{call:async(...args)=>notices.push(args)}});
 assert.deepEqual(db.sql.prepare('SELECT messageId FROM messages ORDER BY messageId').all().map(r=>r.messageId),[2,3]);
 assert.deepEqual(db.sql.prepare('SELECT id FROM agent_messages ORDER BY id').all().map(r=>r.id),[2,3]);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM button_state').get().n,2);
 assert.equal(db.agent('b',1).notes,'Persistent notes');assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,2);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM task_firings').get().n,2);
 assert.equal(fs.existsSync(old),false);for(const f of [boundary,fresh,permanent])assert.equal(fs.existsSync(f),true);
 assert.equal(fs.existsSync(path.join(images,'old.png')),false);assert.equal(fs.existsSync(path.join(images,'fresh.png')),true);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM generated_images').get().n,1);assert.equal(notices.length,0);
});

test('Linux deletion denial reports all failed files only to bot owner and truncates long reports', {skip:process.platform!=='linux'}, async t=>{
 assert.notEqual(process.getuid(),0,'Run acceptance as ordinary production user');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-retention-denied-')),db=openDatabase(path.join(root,'db.sqlite')),dir=path.join(root,'bots','b','.temp','a');fs.mkdirSync(dir,{recursive:true});
 t.after(()=>{fs.chmodSync(dir,0o700);db.close();fs.rmSync(root,{recursive:true,force:true});});db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:123});
 const names=['first.txt','second.txt'];for(const name of names){const f=path.join(dir,name);fs.writeFileSync(f,'old');fs.utimesSync(f,new Date(0),new Date(0));}fs.chmodSync(dir,0o500);
 const notices=[];const options={db,config:{botsDir:path.join(root,'bots')},telegram:{call:async(...args)=>notices.push(args)}};await retention(options);
 assert.equal(notices.length,1);assert.equal(notices[0][0],'b');assert.equal(notices[0][1],'sendMessage');assert.equal(notices[0][2].chat_id,123);for(const name of names)assert.ok(notices[0][2].text.includes(name));assert.match(notices[0][2].text,/cleanup_temp/);assert.match(notices[0][2].text,/\/rm/);
 fs.chmodSync(dir,0o700);for(let i=0;i<30;i++){const f=path.join(dir,`${i}-${'x'.repeat(160)}`);fs.writeFileSync(f,'old');fs.utimesSync(f,new Date(0),new Date(0));}fs.chmodSync(dir,0o500);await retention(options);assert.ok(notices[1][2].text.length<4096);assert.match(notices[1][2].text,/обрезано/);
});
