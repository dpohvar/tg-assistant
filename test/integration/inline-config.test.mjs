import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../../src/config.mjs';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
function config(t,inline){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'inline-config-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'config.json');
  fs.writeFileSync(file,JSON.stringify({serviceOwnerId:1,dataDir:path.join(root,'control'),botsDir:path.join(root,'bots'),codexHome:path.join(root,'auth'),codexExecutable:path.join(root,'bin','codex'),masterTokenFile:path.join(root,'secrets','master'),inline}));
  return ()=>loadConfig(file);
}
test('inline policy merges explicit row and timer settings with defaults',t=>{
  const loaded=config(t,{triggerMs:750,promptRows:12})();
  assert.equal(loaded.inline.triggerMs,750); assert.equal(loaded.inline.promptRows,12);
  assert.equal(loaded.inline.waitMs,5000);
});

test('default inline settings retain 2s/5s timers and use the accepted 6,6,20 prompt scale',t=>{
  assert.deepEqual(config(t,undefined)().inline,{triggerMs:2000,waitMs:5000,promptRows:[6,6,20]});
});

test('configured prompt scales are immutable and numeric row overrides remain supported',t=>{
  const loaded=config(t,{promptRows:[6,6,20]})();
  assert.deepEqual(loaded.inline.promptRows,[6,6,20]);assert.equal(Object.isFrozen(loaded.inline.promptRows),true);
  assert.equal(config(t,{promptRows:12})().inline.promptRows,12);
});

test('the application controller accepts the complete configuration returned by loadConfig',async t=>{
  const loaded=config(t,{promptRows:[6,6,20]})(),db=openDatabase(':memory:');let controller;
  t.after(async()=>{controller?.close();await controller?.idle();db.close();});
  controller=createController({db,config:loaded,agent:{run:async()=>({})},telegram:{call:async()=>assert.fail('No Telegram call is required to boot an empty fixture')}});
  await controller.ready;
});
for(const inline of [{waitMs:-1},{triggerMs:NaN},{promptRows:0},{promptRows:51},{promptRows:[]},{promptRows:[6,0]},{promptRows:[6,51]},{promptRows:[6,1.5]},{promptRows:['6']},{waitMs:1.5},{unknown:1},[],null]) {
  test('invalid inline configuration is rejected: '+JSON.stringify(inline),t=>assert.throws(config(t,inline),/inline/i));
}
