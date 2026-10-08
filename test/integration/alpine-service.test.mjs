import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {serviceCommand} from '../../src/service/alpine.mjs';
test('Alpine service starts once, reports readiness and stops gracefully', {skip:process.platform!=='linux'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-service space-'));const entry=path.join(root,'fake main.mjs'),configFile=path.join(root,'config.json'),dataDir=path.join(root,'control');fs.mkdirSync(dataDir);
 fs.writeFileSync(configFile,JSON.stringify({dataDir}));
 fs.writeFileSync(entry,`import {ignoreHangup} from ${JSON.stringify(new URL('../../src/service/signals.mjs',import.meta.url).href)};ignoreHangup();import fs from 'node:fs';import path from 'node:path';const c=JSON.parse(fs.readFileSync(process.argv[2]));const lock=path.join(c.dataDir,'controller.lock'),ready=path.join(c.dataDir,'controller.ready');const owner={pid:process.pid,nonce:'test'};fs.writeFileSync(lock,JSON.stringify(owner),{flag:'wx'});setTimeout(()=>fs.writeFileSync(ready,JSON.stringify(owner)),100);const timer=setInterval(()=>{},1000);process.on('SIGTERM',()=>{fs.writeFileSync(path.join(c.dataDir,'graceful'),'yes');fs.unlinkSync(ready);fs.unlinkSync(lock);clearInterval(timer);});`);
 t.after(async()=>{try{await serviceCommand('stop',configFile,{entry,timeoutMs:2000});}finally{fs.rmSync(root,{recursive:true,force:true});}});
 assert.equal((await serviceCommand('status',configFile,{entry})).state,'stopped');
 const started=await serviceCommand('start',configFile,{entry,timeoutMs:3000});assert.equal(started.state,'running');assert.ok(started.pid>0);
 assert.equal((await serviceCommand('start',configFile,{entry})).pid,started.pid);
 process.kill(started.pid,'SIGHUP');await new Promise(r=>setTimeout(r,50));
 assert.equal((await serviceCommand('status',configFile,{entry})).state,'running');
 assert.equal((await serviceCommand('stop',configFile,{entry,timeoutMs:3000})).state,'stopped');assert.equal(fs.readFileSync(path.join(dataDir,'graceful'),'utf8'),'yes');
 assert.equal((await serviceCommand('stop',configFile,{entry})).state,'stopped');
 fs.writeFileSync(path.join(dataDir,'controller.lock'),JSON.stringify({pid:process.pid,nonce:'wrong'}));
 await assert.rejects(serviceCommand('stop',configFile,{entry}),/identity|belong/i);fs.unlinkSync(path.join(dataDir,'controller.lock'));
});

test('Alpine startup failure returns an error instead of a false success', {skip:process.platform!=='linux'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-service-fail-')),entry=path.join(root,'main.mjs'),configFile=path.join(root,'config.json');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(configFile,JSON.stringify({dataDir:path.join(root,'control')}));fs.writeFileSync(entry,'console.error("fixture startup failed");process.exitCode=1;');
 await assert.rejects(serviceCommand('start',configFile,{entry,timeoutMs:2000}),/exited during startup/);
 assert.match(fs.readFileSync(path.join(root,'control','service.log'),'utf8'),/fixture startup failed/);
});
