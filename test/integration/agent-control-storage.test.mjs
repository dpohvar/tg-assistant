import {test} from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createControlStore} from '../../src/agents/control-store.mjs';
import {createWorkStore} from '../../src/agents/work.mjs';
test('pause and a unique compact request survive reconstruction and invalidation fences continuation',()=>{
 const db=openDatabase(':memory:');try{db.registerBot({botId:'b',telegramId:2,username:'b',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1),store=createControlStore(db);
 store.pause(a.agentId,{workIds:['w']});assert.equal(createControlStore(db).read(a.agentId).phase,'paused');
 const op=store.requestCompact(a.agentId,{kind:'agent',continuation:'continue',boundary:7});
 assert.equal(store.requestCompact(a.agentId,{kind:'manual'}).operationId,op.operationId);
 assert.equal(store.transition(op.operationId,'queued',{phase:'running'}),true);assert.equal(store.transition(op.operationId,'queued',{phase:'succeeded'}),false);
 store.invalidate(a.agentId,'clear');assert.equal(store.operation(op.operationId).continuationPhase,'cancelled');assert.equal(store.read(a.agentId).phase,'paused');
 db.sql.prepare('DELETE FROM bots WHERE botId=?').run('b');assert.equal(store.pending().length,0);
 }finally{db.close();}
});
test('work origins persist over suspension and terminal settlement is once',()=>{
 const db=openDatabase(':memory:');try{db.registerBot({botId:'b',telegramId:2,username:'b',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1),work=createWorkStore(db),id=work.begin(a,[{taskId:'t'}]);
 work.suspend(id,'op');work.addOrigins(id,[{senderId:'other'}]);assert.equal(work.get(id).origins.length,2);assert.equal(work.finish(id,'completed'),true);assert.equal(work.finish(id,'completed'),false);
 }finally{db.close();}
});

test('work replaces pending child identity with exact turn and deduplicates native ACK',()=>{const db=openDatabase(':memory:');try{db.registerBot({botId:'b',telegramId:2,username:'b',ownerId:1});db.saveChat('b',{id:1,type:'private'});const a=db.ensureAgent('b',1),w=createWorkStore(db),id=w.begin(a,[]);w.bindTurn(id,{threadId:'child'});w.bindTurn(id,{threadId:'child',turnId:'t'});w.bindTurn(id,{threadId:'child',turnId:'t'});assert.deepEqual(w.get(id).turns,[{threadId:'child',turnId:'t'}]);}finally{db.close();}});
