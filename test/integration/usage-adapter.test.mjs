import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {openDatabase} from '../../src/storage/database.mjs';
import {createUsageStore} from '../../src/storage/usage.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';
test('adapter seeds existing resume before notifications, counts child/images and persists across detach',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-usage-adapter-')),db=openDatabase(path.join(root,'db'));db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);db.sql.prepare('UPDATE agents SET threadId=? WHERE agentId=?').run('usage-root',scope.agentId);
 const agent=new CodexAgent({db,config:{botsDir:root,codexHome:root,codexExecutable:process.execPath},spawnArgs:[path.resolve('test/fixtures/usage-server.mjs'),path.join(root,'image')]});t.after(async()=>{await agent.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 await (await agent.run(scope,[],async()=>({}))).settled;const usage=createUsageStore(db),total=usage.list()[0].total;
 assert.equal(total.inputTokens,150);assert.equal(total.imageGenerations,1);assert.equal(total.imageBytes,20);
 agent.detach(scope.agentId);await (await agent.run(scope,[],async()=>({}))).settled;
 assert.equal(usage.list()[0].total.inputTokens,150);assert.equal(usage.list()[0].total.imageGenerations,1);
 await agent.deleteSession(scope.agentId);assert.equal(db.sql.prepare('SELECT count(*) n FROM usage_threads').get().n,0);assert.equal(usage.list()[0].total.inputTokens,150);
});
