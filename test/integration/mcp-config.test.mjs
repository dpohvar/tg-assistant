import test from 'node:test';import assert from 'node:assert/strict';
import {parseMcpConfig,redactMcpConfig,nativeMcpOverrides} from '../../src/mcp/config.mjs';
import {createMcpStore} from '../../src/mcp/store.mjs';import {openDatabase} from '../../src/storage/database.mjs';
test('native TOML validation, no secret in parser error or display, no stdio/OAuth',()=>{
 const config=parseMcpConfig('url="https://example.com/private?token=canary91827"\n[http_headers]\nAuthorization="Bearer canary91827"');assert.equal(config.http_headers.Authorization,'Bearer canary91827');assert.ok(!JSON.stringify(redactMcpConfig(config)).includes('canary91827'));
 for(const text of ['url="canary91827','command="sh"','url="https://example.com"\n[oauth]\nclient_id="x"','url="https://example.com"\nstartup_timeout_sec=-1','url="file:///tmp"','url="https://example.com"\nhttp_headers={X="a\\nb"}'])assert.throws(()=>parseMcpConfig(text),e=>!e.message.includes('canary91827'));
 assert.ok(nativeMcpOverrides('a',[{name:'x',config}]).some(x=>x.includes('http_headers')));
});
test('MCP scope, replace not merge, revision and cascade',t=>{const db=openDatabase(':memory:');t.after(()=>db.close());for(const botId of ['a','b'])db.registerBot({botId,telegramId:botId==='a'?1:2,username:botId,ownerId:1});const store=createMcpStore(db);store.set('a','x',{url:'https://a.test'});store.set('b','x',{url:'https://b.test'});store.set('a','x',{url:'https://a2.test'});assert.equal(store.get('a','x').config.url,'https://a2.test');assert.equal(store.revision('a'),2);store.delete('a','x');assert.equal(store.revision('a'),3);db.sql.prepare('DELETE FROM bots WHERE botId=?').run('b');assert.equal(db.sql.prepare('SELECT count(*) n FROM mcp_servers').get().n,0);});
