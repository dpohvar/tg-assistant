import test from 'node:test';import assert from 'node:assert/strict';
import {isolatedMcpArgs} from '../../src/mcp/runtime.mjs';
import {nativeServerName} from '../../src/mcp/config.mjs';
test('MCP overrides disable inherited servers and plugins and use bot namespaces',async()=>{
 const args=await isolatedMcpArgs({botId:'a',entries:[{name:'same',config:{url:'https://a.test'}}],args:['app-server'],readConfig:async()=>({mcp_servers:{same:{command:'sh'},foreign:{url:'https://b.test'}},plugins:{'x@y':{enabled:true}}})});
 assert.ok(args.includes('mcp_servers."same".enabled=false'));assert.ok(args.includes('mcp_servers."foreign".enabled=false'));assert.ok(args.includes('plugins."x@y".enabled=false'));assert.ok(args.some(x=>x.startsWith('mcp_servers={')&&x.includes('https://a.test')));assert.ok(!args.join(' ').includes('https://b.test'));
});
test('inherited server cannot hijack the generated native namespace with stdio',async()=>{
 await assert.rejects(isolatedMcpArgs({botId:'a',entries:[{name:'x',config:{url:'https://a.test',enabled:true}}],args:[],readConfig:async()=>({mcp_servers:{[nativeServerName('a','x')]:{command:'sh'}}})}),{code:'mcp_config_failed'});
});
