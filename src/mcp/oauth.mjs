import {spawn} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import {isolatedMcpArgs} from './runtime.mjs';
import {nativeServerName} from './config.mjs';

const error = message => Object.assign(new Error(message), {code:'mcp_oauth_failed',safe:true});
const same = (a,b) => {const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&timingSafeEqual(x,y);};
async function terminate(child,exited,graceMs=1000){
  const wait=async()=>{let timer;try{return await Promise.race([exited.then(()=>true),new Promise(r=>timer=setTimeout(()=>r(false),graceMs))]);}finally{clearTimeout(timer);}};
  child.kill();if(await wait())return;child.kill('SIGKILL');if(!await wait())throw error('OAuth process did not terminate.');
}

// CLI output is kept only in memory, bounded, and never logged or returned on error.
export class OAuthLoginProcess {
  constructor({child,startupTimeoutMs=30000,maxOutputBytes=65536,terminationGraceMs=1000}) {
    this.terminationGraceMs=terminationGraceMs;
    this.child=child;this.output='';this.outputBytes=0;this.finished=false;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.done=new Promise((resolve,reject)=>{this.resolveDone=resolve;this.rejectDone=reject;});
    this.ready.catch(()=>{});this.done.catch(()=>{});
    this.exited=new Promise(resolve=>child.once('close',resolve));
    this.timer=setTimeout(()=>this.fail(error('OAuth login did not provide an authorization link. Check provider and Codex compatibility.')),startupTimeoutMs);
    child.stdout.on('data',chunk=>{
      if(this.finished||this.authorization)return;
      this.outputBytes+=chunk.length;
      if(this.outputBytes>maxOutputBytes)return this.fail(error('OAuth login output exceeded its limit.'));
      this.output+=chunk.toString();
      for(const value of this.output.match(/https?:\/\/[^\s<>]+/g)??[]) {
        let u;try{u=new URL(value);}catch{continue;}
        if(u.searchParams.get('response_type')!=='code'||!u.searchParams.get('state')||!u.searchParams.get('redirect_uri'))continue;
        // Wait for the full line; chunks may split a URL in the middle.
        if(!this.output.includes(value+'\n')&&!this.output.includes(value+'\r'))continue;
        let redirect;try{redirect=new URL(u.searchParams.get('redirect_uri'));}catch{continue;}
        if(!['http:','https:'].includes(redirect.protocol)||redirect.username||redirect.password||redirect.hash)continue;
        this.authorization={url:u.href,state:u.searchParams.get('state'),redirect};this.output='';clearTimeout(this.timer);this.resolveReady(this.authorization);break;
      }
    });
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>this.fail(error('OAuth login input failed. Start a new login.')));
    child.on('error',()=>this.fail(error('OAuth process could not start. Check the Codex executable.')));
    child.once('close',code=>{
      if(this.finished)return;this.finished=true;clearTimeout(this.timer);
      if(code===0&&this.authorization){this.resolveDone();}
      else{const e=error('OAuth login failed or was cancelled. Start /mcp auth again.');this.rejectReady(e);this.rejectDone(e);}
    });
  }
  fail(e){if(this.finished)return;this.finished=true;clearTimeout(this.timer);this.rejectReady(e);this.rejectDone(e);this.stopping=terminate(this.child,this.exited,this.terminationGraceMs);this.stopping.catch(()=>{});}
  submit(url){if(this.finished)throw error('OAuth login is no longer waiting.');this.child.stdin.write(url+'\n');return this.done;}
  async close(){this.fail(error('OAuth login cancelled.'));this.child.stdin.end();await (this.stopping??this.exited);}
}

export class McpOAuth {
  pending=new Map();operations=new Map();locks=new Map();blockedBots=new Set();authAlerts=new Set();closed=false;
  constructor({startLogin,logout,onChanged=()=>{},notify=async()=>{},notifyOwner=async()=>{},timeoutMs=600000}){Object.assign(this,{startLogin,logoutRuntime:logout,onChanged,notify,notifyOwner,timeoutMs});}
  key(botId,name){return JSON.stringify([botId,name]);}
  hasInvitation(botId,chatId,messageId){return [...this.pending.values()].some(j=>j.scope.botId===botId&&j.scope.chatId===chatId&&j.scope.messageId===messageId);}
  async reportStatus(botId,entries,rows){if(this.closed||this.blockedBots.has(botId))return;for(const entry of entries){if(entry.config.enabled===false)continue;const row=rows.find(r=>r.name===nativeServerName(botId,entry.name)),key=this.key(botId,entry.name);if(row?.authStatus==='oAuth'&&!row.toolsError){this.authAlerts.delete(key);continue;}if(row?.authStatus==='notLoggedIn'&&/auth required|authorization required|OAuth.*(?:rejected|invalid|failed|required)/i.test(row.toolsError??'')&&!this.authAlerts.has(key)){this.authAlerts.add(key);try{await this.notifyOwner(botId,`MCP ${entry.name} requires authorization. Run /mcp auth ${entry.name} in a private chat.`);}catch{}}}}
  async withConnection(botId,name,fn){const key=this.key(botId,name),previous=this.locks.get(key)??Promise.resolve();const work=previous.catch(()=>{}).then(()=>{if(this.closed)throw error('OAuth service is stopped.');if(this.blockedBots.has(botId))throw error('Bot is being deleted.');return fn();});this.locks.set(key,work);try{return await work;}finally{if(this.locks.get(key)===work)this.locks.delete(key);}}
  async start(scope,entry){
    if(this.closed||this.blockedBots.has(scope.botId))throw error('OAuth service is stopped for this bot.');
    await this.cancel(scope.botId,entry.name);
    if(this.closed||this.blockedBots.has(scope.botId))throw error('OAuth service is stopped for this bot.');
    const key=this.key(scope.botId,entry.name),job={scope,entry,abort:new AbortController()};
    this.pending.set(key,job);job.timer=setTimeout(()=>{void this.expire(scope.botId,entry.name,job);},this.timeoutMs);
    job.started=Promise.resolve().then(()=>this.startLogin(scope.botId,entry,job.abort.signal));job.started.catch(()=>{});
    try{
      job.process=await job.started;
      if(job.abort.signal.aborted||this.pending.get(key)!==job){await job.process.close();throw error('OAuth attempt was replaced or cancelled.');}
      job.authorization=await job.process.ready;
      // Handle failure while waiting for the user's reply, without unhandled rejection.
      job.process.done.catch(async()=>{if(this.pending.get(key)===job&&!job.submitted){this.pending.delete(key);clearTimeout(job.timer);await this.notify(scope,'OAuth login ended. Start /mcp auth again.');}}).catch(()=>{});
      return {url:job.authorization.url,redirectUri:job.authorization.redirect.href};
    }catch(e){job.abort.abort();if(job.process)try{await job.process.close();}catch{}if(this.pending.get(key)===job)this.pending.delete(key);clearTimeout(job.timer);throw e?.safe?e:error('OAuth login could not start. Check MCP configuration and provider support.');}
  }
  async finish(scope,value){
    const key=this.key(scope.botId,scope.name),job=this.pending.get(key);
    if(!job||!job.authorization)throw error('No pending OAuth login. Start /mcp auth again.');
    if(job.scope.userId!==scope.userId||job.scope.chatId!==scope.chatId||job.scope.messageId!==scope.messageId)throw error('Reply to your own current /mcp auth command.');
    if(job.submitted)throw error('OAuth callback is already being processed.');
    let u;try{if(typeof value!=='string'||/[\s]/.test(value))throw 0;u=new URL(value);}catch{throw error('Send the complete callback URL from the browser address bar.');}
    const a=job.authorization,r=a.redirect;
    if(u.origin!==r.origin||u.pathname!==r.pathname||u.hash||u.username||u.password||u.searchParams.getAll('state').length!==1||!same(u.searchParams.get('state'),a.state))throw error('OAuth callback does not match this login. Copy the complete URL for the latest attempt.');
    for(const [k,v] of r.searchParams)if(u.searchParams.getAll(k).length!==1||u.searchParams.get(k)!==v)throw error('OAuth callback address does not match this login.');
    if(u.searchParams.getAll('code').length>1||u.searchParams.getAll('error').length>1||(!u.searchParams.get('code')&&!u.searchParams.get('error'))||(u.searchParams.has('code')&&u.searchParams.has('error')))throw error('OAuth callback must contain one authorization code or error.');
    if(u.searchParams.has('error')){await this.cancel(scope.botId,scope.name);throw error('OAuth authorization was denied or failed. Start /mcp auth again.');}
    job.submitted=true;
    try{await job.process.submit(u.href);if(job.abort.signal.aborted||this.pending.get(key)!==job)throw error('OAuth attempt was cancelled.');this.authAlerts.delete(key);this.onChanged(scope.botId);}
    finally{if(this.pending.get(key)===job)this.pending.delete(key);clearTimeout(job.timer);}
  }
  async cancel(botId,name){const key=this.key(botId,name),job=this.pending.get(key);if(!job)return;this.pending.delete(key);clearTimeout(job.timer);job.abort.abort();try{const p=job.process??await job.started;await p.close();}catch{}}
  async expire(botId,name,job=this.pending.get(this.key(botId,name))){if(!job||this.pending.get(this.key(botId,name))!==job)return;await this.cancel(botId,name);if(!this.closed)try{await this.notify(job.scope,'OAuth login expired. Start /mcp auth again.');}catch{}}
  async logout(botId,entry,{refresh=true}={}){if(this.closed)throw error('OAuth service is stopped.');await this.cancel(botId,entry.name);if(this.closed)throw error('OAuth service is stopped.');const abort=new AbortController();const work=Promise.resolve().then(()=>this.logoutRuntime(botId,entry,abort.signal));this.operations.set(abort,work);try{await work;this.authAlerts.add(this.key(botId,entry.name));if(refresh&&!this.closed)this.onChanged(botId);}finally{this.operations.delete(abort);}}
  async cancelBot(botId){await Promise.all([...this.pending.values()].filter(j=>j.scope.botId===botId).map(j=>this.cancel(botId,j.entry.name)));}
  async deleteBot(botId,getEntries){this.blockedBots.add(botId);try{await this.cancelBot(botId);await Promise.allSettled([...this.locks].filter(([key])=>JSON.parse(key)[0]===botId).map(([,work])=>work));for(const entry of getEntries())await this.logout(botId,entry,{refresh:false});}catch(e){this.blockedBots.delete(botId);throw e;}}
  allowBot(botId){this.blockedBots.delete(botId);}
  async close(){this.closed=true;for(const a of this.operations.keys())a.abort();await Promise.all([...this.pending.values()].map(j=>this.cancel(j.scope.botId,j.entry.name)));await Promise.allSettled([...this.locks.values(),...this.operations.values()]);}
}

export function createOAuthRuntime({config,prepare=isolatedMcpArgs,spawnProcess=spawn,terminationGraceMs=1000}){
  const options=async(botId,entry,signal)=>{
    if(!config?.codexExecutable||!config.codexHome)throw error('Codex runtime is not configured.');
    const env={...process.env,CODEX_HOME:config.codexHome};for(const k of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|API_KEY/i.test(k))delete env[k];
    const cwd=config.codexHome;
    const args=await prepare({executable:config.codexExecutable,args:['app-server','--stdio','--strict-config'],cwd,env,botId,entries:[{...entry,config:{...entry.config,enabled:true}}],signal});
    signal?.throwIfAborted();return {executable:config.codexExecutable,cwd,env,args:args.slice(3)};
  };
  return {
    async startLogin(botId,entry,signal){const o=await options(botId,entry,signal);const child=spawnProcess(o.executable,['mcp','login',nativeServerName(botId,entry.name),'--no-browser',...o.args],{cwd:o.cwd,env:o.env,windowsHide:true,stdio:['pipe','pipe','pipe']});const p=new OAuthLoginProcess({child,terminationGraceMs});const abort=()=>{void p.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});p.exited.finally(()=>signal?.removeEventListener('abort',abort));if(signal?.aborted)abort();return p;},
    async logout(botId,entry,signal){const o=await options(botId,entry,signal);await new Promise((resolve,reject)=>{
      const child=spawnProcess(o.executable,['mcp','logout',nativeServerName(botId,entry.name),...o.args],{cwd:o.cwd,env:o.env,windowsHide:true,stdio:['ignore','ignore','ignore']});
      const exited=new Promise(r=>child.once('close',r));let stopping=false;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
      const stop=()=>{if(stopping)return;stopping=true;cleanup();void terminate(child,exited,terminationGraceMs).catch(()=>{}).finally(()=>reject(error('OAuth logout was cancelled or timed out.')));};
      const timer=setTimeout(stop,30000);signal?.addEventListener('abort',stop,{once:true});
      child.once('error',()=>{cleanup();if(!stopping)reject(error('OAuth logout could not start.'));});
      child.once('close',code=>{cleanup();if(!stopping)code===0?resolve():reject(error('OAuth logout failed. Retry before deleting the connection.'));});
      if(signal?.aborted)stop();
    });},
  };
}
