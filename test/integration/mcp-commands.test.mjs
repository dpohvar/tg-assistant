import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';import {createCommands} from '../../src/commands/router.mjs';import {createMcpStore} from '../../src/mcp/store.mjs';
test('MCP set uses native pre, removes sensitive message, enforces roles and redacts show',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'a',telegramId:1,username:'a',ownerId:1});db.setRole('a',2,'user');const calls=[],refresh=[];const c=createCommands({db,requestMcpRefresh:async b=>refresh.push(b),testMcp:async()=>({tools:['echo']}),telegram:{call:async(b,m,p)=>{calls.push({m,p});return {};}}});
 const config='url="https://example.com/path?secret=canary918"\n[http_headers]\nAuthorization="Bearer canary918"';const text='/mcp set demo '+config,m={message_id:1,from:{id:1},chat:{id:1,type:'private'},text,entities:[{type:'pre',offset:14,length:config.length}]};
 await c.handle('a',m);assert.equal(createMcpStore(db).get('a','demo').config.http_headers.Authorization,'Bearer canary918');assert.equal(calls.at(-1).m,'deleteMessage');assert.deepEqual(refresh,['a']);assert.ok(!JSON.stringify(calls).includes('canary918'));
 calls.length=0;await c.handle('a',{...m,text:'/mcp show demo',entities:[]});assert.ok(!JSON.stringify(calls).includes('canary918'));await c.handle('a',{...m,from:{id:2}});assert.equal(createMcpStore(db).revision('a'),1);
 calls.length=0;await c.handle('a',{...m,text:'/mcp set demo badcanary918',entities:[]});assert.equal(calls.at(-1).m,'deleteMessage');assert.ok(!JSON.stringify(calls).includes('badcanary918'));
});
test('MCP list reports connection and OAuth state independently without exposing errors',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'a',telegramId:1,username:'a',ownerId:1});const store=createMcpStore(db),calls=[],checked=[];
 for(const name of ['connected','disabled','auth','missing','unavailable'])store.set('a',name,{url:'https://example.test/private?secret=canary',...(name==='disabled'?{enabled:false}:{})});
 const router=createCommands({db,testMcp:async(b,e)=>{checked.push(e.name);if(e.name==='unavailable')throw Error('canary');if(e.name==='missing')throw Object.assign(Error('canary'),{code:'mcp_auth_required'});return {status:'connected',authStatus:e.name==='auth'?'notLoggedIn':'oAuth',tools:['echo']};},telegram:{call:async(b,m,p)=>calls.push(p)}});
 const message={message_id:1,text:'/mcp',from:{id:1},chat:{id:1,type:'private'}};await router.handle('a',message);const output=calls.at(-1).text;
 assert.match(output,/connected · https:\/\/example.test · connected/);assert.match(output,/disabled · https:\/\/example.test · disabled/);assert.match(output,/auth · https:\/\/example.test · authorization required/);assert.match(output,/missing · https:\/\/example.test · authorization required/);assert.match(output,/unavailable · https:\/\/example.test · unavailable/);assert.ok(!checked.includes('disabled'));assert.ok(!output.includes('canary'));
 assert.deepEqual(calls.at(-1).entities.map(e=>[e.type,output.slice(e.offset,e.offset+e.length)]),[['code','auth'],['italic','authorization required'],['code','connected'],['italic','connected'],['code','disabled'],['italic','disabled'],['code','missing'],['italic','authorization required'],['code','unavailable'],['italic','unavailable']]);
 await router.handle('a',{...message,text:'/mcp test auth'});assert.match(calls.at(-1).text,/authorization required/);assert.match(calls.at(-1).text,/OAuth: notLoggedIn/);
});
