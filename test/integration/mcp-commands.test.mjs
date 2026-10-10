import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';import {createCommands} from '../../src/commands/router.mjs';import {createMcpStore} from '../../src/mcp/store.mjs';
test('MCP set uses native pre, removes sensitive message, enforces roles and redacts show',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'a',telegramId:1,username:'a',ownerId:1});db.setRole('a',2,'user');const calls=[],refresh=[];const c=createCommands({db,requestMcpRefresh:async b=>refresh.push(b),testMcp:async()=>({tools:['echo']}),telegram:{call:async(b,m,p)=>{calls.push({m,p});return {};}}});
 const config='url="https://example.com/path?secret=canary918"\n[http_headers]\nAuthorization="Bearer canary918"';const text='/mcp set demo '+config,m={message_id:1,from:{id:1},chat:{id:1,type:'private'},text,entities:[{type:'pre',offset:14,length:config.length}]};
 await c.handle('a',m);assert.equal(createMcpStore(db).get('a','demo').config.http_headers.Authorization,'Bearer canary918');assert.equal(calls.at(-1).m,'deleteMessage');assert.deepEqual(refresh,['a']);assert.ok(!JSON.stringify(calls).includes('canary918'));
 calls.length=0;await c.handle('a',{...m,text:'/mcp show demo',entities:[]});assert.ok(!JSON.stringify(calls).includes('canary918'));await c.handle('a',{...m,from:{id:2}});assert.equal(createMcpStore(db).revision('a'),1);
 calls.length=0;await c.handle('a',{...m,text:'/mcp set demo badcanary918',entities:[]});assert.equal(calls.at(-1).m,'deleteMessage');assert.ok(!JSON.stringify(calls).includes('badcanary918'));
});
