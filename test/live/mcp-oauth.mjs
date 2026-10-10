// No model turn, no real external account. Usage: node test/live/mcp-oauth.mjs ROOT CODEX_EXE
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
import {McpOAuth,createOAuthRuntime} from '../../src/mcp/oauth.mjs';import {CodexAgent} from '../../src/codex/threads.mjs';import {openDatabase} from '../../src/storage/database.mjs';import {createMcpStore} from '../../src/mcp/store.mjs';import {createController} from '../../src/controller.mjs';
const [root,executable]=process.argv.slice(2);if(!root||!executable)throw Error('Supply ROOT CODEX_EXE');
fs.mkdirSync(root,{recursive:true});const home=fs.mkdtempSync(path.join(root,'oauth-')),codes=new Map(),tokens=new Map(),refreshTokens=new Map();let exchanges=0,refreshes=0,callbacks=0,toolCalls=0;
const issue=account=>{const token=randomUUID(),refresh=randomUUID();tokens.set(token,account);refreshTokens.set(refresh,account);return {access_token:token,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'test'};};
const server=http.createServer(async(req,res)=>{try{
 let raw='';for await(const c of req)raw+=c;const u=new URL(req.url,origin),json=(v,s=200)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
 if(u.pathname.startsWith('/.well-known/oauth-protected-resource'))return json({resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:['test']});
 if(u.pathname.startsWith('/.well-known/oauth-authorization-server'))return json({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_basic','client_secret_post'],scopes_supported:['test']});
 if(u.pathname==='/register')return json({...JSON.parse(raw),client_id:randomUUID()},201);
 if(u.pathname==='/authorize'){const code=randomUUID();codes.set(code,{challenge:u.searchParams.get('code_challenge'),redirect:u.searchParams.get('redirect_uri'),account:u.searchParams.get('account')});const cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('code',code);cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('iss',origin);res.writeHead(302,{Location:cb.href});return res.end();}
 if(u.pathname==='/token'){const p=new URLSearchParams(raw);if(p.get('client_secret')!=='fixture-secret'&&req.headers.authorization!=='Basic '+Buffer.from('fixture-client:fixture-secret').toString('base64'))return json({error:'invalid_client'},401);if(p.get('grant_type')==='refresh_token'){const account=refreshTokens.get(p.get('refresh_token'));if(!account)return json({error:'invalid_grant'},400);refreshTokens.delete(p.get('refresh_token'));refreshes++;return json(issue(account));}
 const c=codes.get(p.get('code'));if(!c||createHash('sha256').update(p.get('code_verifier')??'').digest('base64url')!==c.challenge||p.get('redirect_uri')!==c.redirect)return json({error:'invalid_grant'},400);codes.delete(p.get('code'));exchanges++;return json(issue(c.account));}
 if(u.pathname.startsWith('/callback')){callbacks++;return json({unexpected:true});}
 if(u.pathname==='/mcp'){const account=tokens.get((req.headers.authorization??'').replace(/^Bearer /,''));if(!account){res.writeHead(401,{'WWW-Authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`});return res.end();}if(req.method!=='POST'){res.writeHead(405);return res.end();}const m=JSON.parse(raw);if(m.id===undefined){res.writeHead(202);return res.end();}let result={};if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'account_'+account,inputSchema:{type:'object'}}]};if(m.method==='tools/call')toolCalls++;return json({jsonrpc:'2.0',id:m.id,result});}
 return json({error:'not_found'},404);
}catch{res.writeHead(500);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const db=openDatabase(':memory:');for(const botId of ['a','b'])db.registerBot({botId,telegramId:botId==='a'?1:2,username:botId,ownerId:1});
const config={dataDir:home,botsDir:path.join(home,'bots'),codexHome:home,codexExecutable:executable};const store=createMcpStore(db),entry={name:'calendar',config:{url:origin+'/mcp',oauth:{client_id:'fixture-client',client_secret:'fixture-secret',callback_url:'http://127.0.0.1:32123/callback'}}};store.set('a',entry.name,entry.config);store.set('b',entry.name,entry.config);
const changes=[],notices=[],manager=new McpOAuth({...createOAuthRuntime({config}),onChanged:b=>changes.push(b),notify:async(...v)=>notices.push(v)}),agent=new CodexAgent({db,config});
const scope=b=>({botId:b,name:entry.name,userId:1,chatId:1,messageId:10});
const approve=async(url,account)=>{const u=new URL(url);u.searchParams.set('account',account);return (await fetch(u,{redirect:'manual'})).headers.get('location');};
const check=async(b,name)=>{const result=await agent.testMcp(b,entry);assert.deepEqual(result.tools,[name]);};
let controller;
try{
 const first=await manager.start(scope('a'),entry);await manager.finish(scope('a'),await approve(first.url,'alice'));await check('a','account_alice');
 const denied=await manager.start({...scope('a'),messageId:11},entry),deniedUrl=new URL(await approve(denied.url,'unused'));deniedUrl.searchParams.delete('code');deniedUrl.searchParams.set('error','access_denied');await assert.rejects(manager.finish({...scope('a'),messageId:11},deniedUrl.href));await check('a','account_alice');assert.equal(exchanges,1);
 const mixed=await manager.start({...scope('a'),messageId:12},entry),mixedUrl=new URL(await approve(mixed.url,'unused'));mixedUrl.searchParams.set('iss','https://other-issuer.test');await assert.rejects(manager.finish({...scope('a'),messageId:12},mixedUrl.href));await check('a','account_alice');assert.equal(exchanges,1);
 await assert.rejects(agent.testMcp('b',entry));
 const second=await manager.start(scope('b'),entry);await manager.finish(scope('b'),await approve(second.url,'bob'));await check('a','account_alice');await check('b','account_bob');
 const file=path.join(home,'.credentials.json'),credentials=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const c of Object.values(credentials))c.expires_at=0;fs.writeFileSync(file,JSON.stringify(credentials),{mode:0o600});
 await check('a','account_alice');await check('b','account_bob');assert.ok(refreshes>=2);assert.equal(exchanges,2);
 await manager.logout('a',entry);await assert.rejects(agent.testMcp('a',entry));await check('b','account_bob');
 // Exercise actual controller command routing and ensure URL does not enter stored history.
 const outputs=[],deletions=[];controller=createController({db,config,agent,telegram:{call:async(b,m,p)=>{if(m==='sendMessage')outputs.push(p);if(m==='deleteMessage')deletions.push(p.message_id);return {};}}});
 const command={message_id:20,text:'/mcp auth calendar',from:{id:1},chat:{id:1,type:'private'}};
 await controller.receive('a',{message:command});const authURL=outputs.at(-1).text.match(/https?:\/\/\S+/)[0],cb=await approve(authURL,'carol');
 await controller.receive('a',{message:{message_id:21,text:cb,from:{id:1},chat:{id:1,type:'private'},reply_to_message:command}});await controller.idle();await check('a','account_carol');assert.ok(deletions.includes(21));assert.ok(!JSON.stringify(outputs).includes(new URL(cb).searchParams.get('code')));assert.equal(db.getMessage('a',1,21),null);
 assert.equal(callbacks,0);assert.equal(toolCalls,0);assert.deepEqual(changes,['a','b','a']);
 console.log(JSON.stringify({passed:true,manualCallback:true,deniedConsentSafe:true,issuerMismatchRejected:true,botNamespacesIsolated:true,freshProcessCredentials:true,refreshes,independentLogout:true,controllerReply:true,callbackHttpRequests:callbacks,modelTurns:0,toolCalls}));
}finally{controller?.close();await controller?.idle();await manager.close();await agent.close();db.close();await new Promise(r=>server.close(r));fs.rmSync(home,{recursive:true,force:true});}
