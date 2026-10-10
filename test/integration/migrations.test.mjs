import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import {DatabaseSync} from 'node:sqlite';

test('schema 9 upgrade retains vault values and adds empty per-bot MCP settings',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-mcp-migration-')),file=path.join(root,'db.sqlite');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const sql=new DatabaseSync(file);
 for(let i=1;i<=9;i++)sql.exec(fs.readFileSync(new URL(`../../src/storage/migrations/${String(i).padStart(3,'0')}.sql`,import.meta.url),'utf8'));
 sql.exec("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',42,'bot',1);INSERT INTO vault VALUES('b','KEEP','synthetic')");sql.close();
 const db=openDatabase(file);try{assert.equal(db.sql.prepare('SELECT value FROM vault').get().value,'synthetic');assert.equal(db.getBot('b').mcpRevision,0);assert.equal(db.sql.prepare('SELECT count(*) n FROM mcp_servers').get().n,0);assert.equal(db.sql.prepare('SELECT max(version) v FROM schema_migrations').get().v,10);}finally{db.close();}
});

test('version 7 upgrades transactionally preserving agents, memory, tasks and passive chats',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-upgrade-')),file=path.join(root,'db.sqlite');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys=ON');for(let i=1;i<=7;i++)sql.exec(fs.readFileSync(new URL(`../../src/storage/migrations/${String(i).padStart(3,'0')}.sql`,import.meta.url),'utf8'));
 sql.exec("INSERT INTO bots(botId,telegramId,username,ownerId) VALUES('b',42,'bot',1); INSERT INTO chats VALUES('b',-1,'group','Friends','{}','[]'),('b',-2,'supergroup','Passive','{}','[]'); INSERT INTO agents(agentId,botId,chatId,model,notes,createdAt) VALUES('a','b',-1,'m','keep',1); INSERT INTO tasks(taskId,agentId,description,text,at,createdAt) VALUES('t','a','keep','instruction','2099-01-01T00:00:00Z',1)");sql.close();
 let db=openDatabase(file);assert.equal(db.getChat('b',-1).agentEnabled,1);assert.equal(db.getChat('b',-2).agentEnabled,0);assert.equal(db.agent('b',-1).notes,'keep');assert.equal(db.sql.prepare('SELECT text FROM tasks WHERE taskId=?').get('t').text,'instruction');db.close();db=openDatabase(file);assert.equal(db.sql.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,10);assert.equal(db.agent('b',-1).notes,'keep');db.close();
});

test('an unsupported newer schema is refused without changing its data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-schema-')), file = path.join(root, 'db.sqlite');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(file);
  db.sql.prepare('INSERT INTO schema_migrations VALUES(999)').run(); db.close();
  assert.throws(() => openDatabase(file), /newer schema/);
});
