import test from 'node:test';import assert from 'node:assert/strict';
import {parseMcpConfig,redactMcpConfig,nativeMcpOverrides} from '../../src/mcp/config.mjs';
import {createMcpStore} from '../../src/mcp/store.mjs';import {openDatabase} from '../../src/storage/database.mjs';
test('native TOML validation, no secret in parser error or display, no stdio',()=>{
 const config=parseMcpConfig('url="https://example.com/private?token=canary91827"\n[http_headers]\nAuthorization="Bearer canary91827"');assert.equal(config.http_headers.Authorization,'Bearer canary91827');assert.ok(!JSON.stringify(redactMcpConfig(config)).includes('canary91827'));
 for(const text of ['url="canary91827','command="sh"','url="https://example.com"\nstartup_timeout_sec=-1','url="file:///tmp"','url="https://example.com"\nhttp_headers={X="a\\nb"}'])assert.throws(()=>parseMcpConfig(text),e=>!e.message.includes('canary91827'));
 assert.ok(nativeMcpOverrides('a',[{name:'x',config}]).some(x=>x.includes('http_headers')));
 assert.ok(nativeMcpOverrides('a',[{name:'x',config}]).some(x=>x.includes('"default_tools_approval_mode"="approve"')));
});
test('OAuth configuration accepts native public-client settings and validates/redacts callbacks',()=>{
 const c=parseMcpConfig('url="https://example.test/mcp"\n[oauth]\nclient_id="registered-client"\nscopes=["calendar.read"]\ncallback_url="http://127.0.0.1/callback"\ncallback_port=3210');assert.equal(c.oauth.client_id,'registered-client');assert.equal(c.oauth.callback_port,3210);
 for(const setting of ['client_id=1','client_secret=1','callback_port=0','callback_port=1.5','callback_url="file:///etc"','scopes="x"','unknown=true'])assert.throws(()=>parseMcpConfig('url="https://example.test"\n[oauth]\n'+setting));
 const secret=parseMcpConfig('url="https://example.test"\n[oauth]\ncallback_url="https://callback.test/path?secret=canary"');assert.ok(!JSON.stringify(redactMcpConfig(secret)).includes('canary'));
});
test('JSON aliases normalize, secrets are hidden in displays and native clients receive required fields',()=>{
 const c=parseMcpConfig(JSON.stringify({serverUrl:'https://example.test/mcp',oauth:{clientId:'client',clientSecret:'secret-canary'}}));
 assert.equal(c.url,'https://example.test/mcp');assert.deepEqual(c.oauth,{client_id:'client',client_secret:'secret-canary'});
 assert.ok(!JSON.stringify(redactMcpConfig(c)).includes('secret-canary'));
 const args=nativeMcpOverrides('a',[{name:'calendar',config:c}]);assert.ok(args.join(' ').includes('"client_secret"="secret-canary"'));
 for(const value of [null,[],{url:'https://a.test',serverUrl:'https://b.test'},{url:'https://a.test',oauth:{clientId:'a',client_id:'b'}},{url:'https://a.test',oauth:{clientSecret:''}},{url:'https://a.test',oauth:{clientSecret:'secret'}}])assert.throws(()=>parseMcpConfig(JSON.stringify(value)));
});
test('MCP scope, replace not merge, revision and cascade',t=>{const db=openDatabase(':memory:');t.after(()=>db.close());for(const botId of ['a','b'])db.registerBot({botId,telegramId:botId==='a'?1:2,username:botId,ownerId:1});const store=createMcpStore(db);store.set('a','x',{url:'https://a.test'});store.set('b','x',{url:'https://b.test'});store.set('a','x',{url:'https://a2.test'});assert.equal(store.get('a','x').config.url,'https://a2.test');assert.equal(store.revision('a'),2);store.delete('a','x');assert.equal(store.revision('a'),3);db.sql.prepare('DELETE FROM bots WHERE botId=?').run('b');assert.equal(db.sql.prepare('SELECT count(*) n FROM mcp_servers').get().n,0);});
