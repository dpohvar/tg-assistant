import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {OAuthLoginProcess,McpOAuth,createOAuthRuntime} from '../../src/mcp/oauth.mjs';
import {handleMcpCommand} from '../../src/commands/mcp.mjs';
import {createMcpStore} from '../../src/mcp/store.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {RpcProcess} from '../../src/codex/rpc.mjs';

const authorization='https://issuer.test/authorize?response_type=code&state=expected&redirect_uri='+encodeURIComponent('http://127.0.0.1:3210/callback/test');
const callback='http://127.0.0.1:3210/callback/test?code=one-time&state=expected';
function fakeChild(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{queueMicrotask(()=>c.emit('close',null));return true;};return c;}
function harness(t){
 const children=[],changes=[],notices=[],logouts=[];
 const manager=new McpOAuth({startLogin:async()=>{const child=fakeChild();children.push(child);const p=new OAuthLoginProcess({child,startupTimeoutMs:200});queueMicrotask(()=>child.stdout.write('Open this URL:\n'+authorization+'\nCallback URL (input hidden): '));return p;},logout:async(b,e)=>logouts.push([b,e.name]),onChanged:b=>changes.push(b),notify:async(...v)=>notices.push(v),timeoutMs:500});
 t.after(()=>manager.close());return {manager,children,changes,notices,logouts};
}
const scope={botId:'a',name:'calendar',userId:1,chatId:1,messageId:10},entry={name:'calendar',config:{url:'https://mcp.test'}};
test('OAuth manually submits validated callback without fetching it and refreshes after successful exit',async t=>{
 const f=harness(t);assert.equal((await f.manager.start(scope,entry)).url,authorization);
 let received='';f.children[0].stdin.on('data',d=>received+=d);
 const done=f.manager.finish(scope,callback);await new Promise(r=>setImmediate(r));assert.equal(received,callback+'\n');f.children[0].emit('close',0);await done;assert.deepEqual(f.changes,['a']);assert.equal(f.manager.pending.size,0);
 await assert.rejects(f.manager.finish(scope,callback),/No pending/);
});
test('OAuth validates owner, invitation identity, state and complete callback address before submitting',async t=>{
 const f=harness(t);await f.manager.start(scope,entry);
 for(const wrong of [{...scope,userId:2},{...scope,chatId:2},{...scope,messageId:11},{...scope,botId:'b'}])await assert.rejects(f.manager.finish(wrong,callback));
 for(const url of [callback.replace('expected','wrong'),callback.replace(':3210',':9999'),callback.replace('/callback/test','/other'),callback+'&state=expected',callback+'#fragment','https://attacker.test/?code=x&state=expected',callback+'\nother'])await assert.rejects(f.manager.finish(scope,url));
 assert.equal(f.children[0].stdin.readableLength,0);assert.equal(f.manager.pending.size,1);
});
test('denied consent cancels immediately without waiting for another CLI prompt',async t=>{
 const f=harness(t);await f.manager.start(scope,entry);await assert.rejects(f.manager.finish(scope,callback.replace('code=one-time','error=access_denied')),/denied/);assert.equal(f.manager.pending.size,0);assert.equal(f.children[0].stdin.readableLength,0);assert.deepEqual(f.changes,[]);
});
test('a new login replaces the old attempt, expiry cancels it, and logout is scoped',async t=>{
 const f=harness(t);await f.manager.start(scope,entry);await f.manager.start({...scope,messageId:11},entry);await assert.rejects(f.manager.finish(scope,callback));
 await f.manager.logout('a',entry);assert.deepEqual(f.logouts,[['a','calendar']]);assert.deepEqual(f.changes,['a']);assert.equal(f.manager.pending.size,0);
});
test('timeout and shutdown settle pending logins without leaking process output',async t=>{
 const f=harness(t);await f.manager.start(scope,entry);await f.manager.expire('a','calendar');assert.equal(f.manager.pending.size,0);assert.ok(f.notices.length===1);assert.ok(!JSON.stringify(f.notices).includes('expected'));
 await f.manager.start(scope,entry);await f.manager.close();assert.equal(f.manager.pending.size,0);await assert.rejects(f.manager.start(scope,entry),/stopped/);
});
test('process rejects unsupported output, spawn failure and bounded startup with sanitized errors',async()=>{
 for(const kind of ['output','error','timeout']){const child=fakeChild(),p=new OAuthLoginProcess({child,startupTimeoutMs:15,maxOutputBytes:256});
 if(kind==='output')child.stdout.write('SECRET'.repeat(100));if(kind==='error')child.emit('error',new Error('SECRET'));
 await assert.rejects(p.ready,e=>!e.message.includes('SECRET'));await assert.rejects(p.done,e=>!e.message.includes('SECRET'));await p.close();}
});
test('failed login does not refresh and multiple bot names stay independent',async t=>{
 const f=harness(t);await f.manager.start(scope,entry);await f.manager.start({...scope,botId:'b'},entry);const done=f.manager.finish(scope,callback);f.children[0].emit('close',1);await assert.rejects(done,/OAuth/);assert.deepEqual(f.changes,[]);assert.equal(f.manager.pending.size,1);await f.manager.cancelBot('b');assert.equal(f.manager.pending.size,0);
});
test('OAuth actually expires on its deadline and rejects a callback still in flight',async t=>{
 const f=harness(t);f.manager.timeoutMs=20;await f.manager.start(scope,entry);const done=f.manager.finish(scope,callback);await assert.rejects(done,/cancelled/);assert.equal(f.manager.pending.size,0);assert.equal(f.changes.length,0);
});
test('start tolerates a split authorization URL but kills a process that exits before readiness',async()=>{
 const c=fakeChild(),p=new OAuthLoginProcess({child:c});c.stdout.write(authorization.slice(0,70));c.stdout.write(authorization.slice(70));c.stdout.write('\n');assert.equal((await p.ready).url,authorization);await p.close();
 const c2=fakeChild(),p2=new OAuthLoginProcess({child:c2});c2.emit('close',1);await assert.rejects(p2.ready,/OAuth/);await assert.rejects(p2.done,/OAuth/);await p2.close();
});
test('failed credential deletion does not refresh or report success',async t=>{
 const f=harness(t);f.manager.logoutRuntime=async()=>{throw Error('unavailable');};await assert.rejects(f.manager.logout('a',entry));assert.deepEqual(f.changes,[]);
});
test('per-connection command lock serializes changes and does not block another bot',async t=>{
 const f=harness(t),order=[];let release;const block=new Promise(r=>release=r);
 const one=f.manager.withConnection('a','calendar',async()=>{order.push(1);await block;});
 const two=f.manager.withConnection('a','calendar',async()=>order.push(2));await f.manager.withConnection('b','calendar',async()=>order.push(3));assert.deepEqual(order,[1,3]);release();await Promise.all([one,two]);assert.deepEqual(order,[1,3,2]);
});
test('bot deletion cancels auth, removes only its entries and rejects new work until re-registration',async t=>{
 const f=harness(t);await f.manager.start(scope,entry);await f.manager.start({...scope,botId:'b'},entry);await f.manager.deleteBot('a',()=>[entry]);assert.deepEqual(f.logouts,[['a','calendar']]);assert.equal(f.manager.pending.size,1);await assert.rejects(f.manager.start(scope,entry));f.manager.allowBot('a');await f.manager.start(scope,entry);assert.equal(f.manager.pending.size,2);
});
test('shutdown waits for a logout process to settle after abort',async t=>{
 const f=harness(t);let started;const ready=new Promise(r=>started=r);f.manager.logoutRuntime=async(b,e,signal)=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));};const work=f.manager.logout('a',entry);await ready;await f.manager.close();await work;assert.equal(f.manager.operations.size,0);
});
test('startup failure and logout shutdown escalate for a SIGTERM-resistant process',async()=>{
 const child=fakeChild(),kills=[];child.kill=sig=>{kills.push(sig??'SIGTERM');if(sig==='SIGKILL')queueMicrotask(()=>child.emit('close',null));return true;};const p=new OAuthLoginProcess({child,startupTimeoutMs:10,terminationGraceMs:10});await assert.rejects(p.ready);await p.close();assert.ok(kills.includes('SIGKILL'));
 const child2=fakeChild(),kills2=[];child2.kill=sig=>{kills2.push(sig??'SIGTERM');if(sig==='SIGKILL')queueMicrotask(()=>child2.emit('close',null));return true;};
 const runtime=createOAuthRuntime({config:{codexExecutable:'fake',codexHome:'.'},prepare:async o=>o.args,spawnProcess:()=>child2,terminationGraceMs:10});const abort=new AbortController();const done=runtime.logout('a',entry,abort.signal);await new Promise(r=>setImmediate(r));abort.abort();await assert.rejects(done,/OAuth/);assert.ok(kills2.includes('SIGKILL'));
});
test('logout cancels a submitted callback without waiting for the connection lock deadline',async t=>{
 const f=harness(t),db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'a',telegramId:1,username:'a',ownerId:1});createMcpStore(db).set('a',entry.name,entry.config);await f.manager.start(scope,entry);
 const callbackWork=f.manager.withConnection('a','calendar',()=>f.manager.finish(scope,callback));callbackWork.catch(()=>{});await new Promise(r=>setImmediate(r));
 const before=Date.now();await handleMcpCommand({botId:'a',parsed:[{value:'logout'},{value:'calendar'}],db,mcpOAuth:f.manager,message:{from:{id:1}},send:async()=>{}});await assert.rejects(callbackWork);assert.ok(Date.now()-before<200,'logout waited for OAuth expiry');assert.equal(f.manager.pending.size,0);
});
test('native authorization-required status notifies the owner once, rearmed by successful authorization',async t=>{
 const f=harness(t),notices=[];f.manager.notifyOwner=async(...x)=>notices.push(x);
 const {nativeServerName}=await import('../../src/mcp/config.mjs');const row={name:nativeServerName('a',entry.name),authStatus:'notLoggedIn',toolsError:'OAuth refresh token was rejected: invalid_grant'};
 await f.manager.reportStatus('a',[entry],[row]);await f.manager.reportStatus('a',[entry],[row]);assert.equal(notices.length,1);assert.ok(!JSON.stringify(notices).includes('invalid_grant'));
 await f.manager.reportStatus('a',[entry],[{...row,authStatus:'oAuth',toolsError:null}]);await f.manager.reportStatus('a',[entry],[row]);assert.equal(notices.length,2);
});
test('Codex RPC preflight termination escalates and has a bounded failure',async()=>{
 for(const exits of [true,false]){const child=fakeChild(),kills=[];let ended;const exited=new Promise(r=>ended=r);child.kill=sig=>{kills.push(sig??'SIGTERM');if(sig==='SIGKILL'&&exits)ended();};const rpc={child,exited,fail:()=>{}};const done=RpcProcess.prototype.close.call(rpc,10);if(exits)await done;else await assert.rejects(done,/stopped/);assert.ok(kills.includes('SIGKILL'));}
});
