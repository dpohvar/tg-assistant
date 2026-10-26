import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {guestAcceptanceGuard,runGuestAcceptance,extractGuestArchive,guestProbeControl} from '../manual/guest-acceptance.mjs';
const config={ownerId:1,botTelegramId:42,controllerActive:false,codexHome:'auth',codexExecutable:'codex',token:'synthetic'};
test('a replayed command from an earlier probe never falls through to ordinary commands',()=>{
  const options={ownerId:1,run:'new'},message={from:{id:1},chat:{id:1,type:'private'}};
  assert.equal(guestProbeControl({...message,text:'/guest stop old'},options),'ignore');
  assert.equal(guestProbeControl({...message,text:'/guest stop new'},options),'stop');
  assert.equal(guestProbeControl({...message,text:'/guest restart new'},options),'restart');
  assert.equal(guestProbeControl({...message,text:'/guest later new'},options),'later');
  assert.equal(guestProbeControl({...message,from:{id:2},chat:{id:2,type:'private'},text:'/guest stop new'},options),'ignore');
  assert.equal(guestProbeControl({...message,from:{id:2},chat:{id:2,type:'private'},text:'/guest join new'},options),'join');
  assert.equal(guestProbeControl({...message,text:'/help'},options),null);
  assert.equal(guestProbeControl({...message,chat:{id:-1,type:'group'},text:'/guest stop new'},options),null);
});
test('archive extraction uses a local basename so Windows drive letters are not remote tar hosts',()=>{
  const archive=path.resolve('fixtures','wordle.tar.gz'),target=path.resolve('runtime','game');let called;
  extractGuestArchive(archive,target,(command,args,options)=>{called={command,args,options};});
  assert.equal(called.command,'tar');assert.deepEqual(called.args,['-xf','wordle.tar.gz','-C',target.replaceAll('\\','/')]);assert.equal(called.options.cwd,path.dirname(archive));assert.equal(called.options.windowsHide,true);
});
test('guest acceptance admits only fresh marked invocations and known exact inline callbacks',()=>{
  const g=guestAcceptanceGuard({botId:'b',ownerId:1,run:'run',startedAt:100000});
  const guest={guest_message:{date:100,guest_query_id:'query',from:{id:1},chat:{id:-1,type:'group'},text:'@bot guest run widget'}};
  assert.equal(g.accept(guest),true);assert.equal(g.accept({guest_message:{...guest.guest_message,date:1}}),false);
  assert.equal(g.accept({guest_message:{...guest.guest_message,text:'unrelated'}}),false);
  assert.equal(g.accept({callback_query:{inline_message_id:'unknown',from:{id:1}}}),false);
  g.allowInline('known');assert.equal(g.accept({callback_query:{inline_message_id:'known',from:{id:2}}}),true);
});
test('guest acceptance effects require observed guest queries and exact owned messages',()=>{
  const g=guestAcceptanceGuard({botId:'b',ownerId:1,run:'run'});
  assert.throws(()=>g.before('b','answerGuestQuery',{guest_query_id:'unknown'}));
  g.allowQuery('q');g.before('b','answerGuestQuery',{guest_query_id:'q'});
  assert.throws(()=>g.before('b','sendMessage',{chat_id:-1,text:'No'}));
  assert.throws(()=>g.before('foreign','sendMessage',{chat_id:1,text:'No'}));
  g.allowInline('known');g.before('b','editMessageText',{inline_message_id:'known',text:'Yes'});
  assert.throws(()=>g.before('b','editMessageText',{inline_message_id:'unknown',text:'No'}));
  assert.throws(()=>g.before('b','deleteMessage',{chat_id:1,message_id:5}));g.allowMessage(1,5);g.before('b','deleteMessage',{chat_id:1,message_id:5});
});
test('guest acceptance budgets remain bounded without imposing a per-query answer count',()=>{
  const g=guestAcceptanceGuard({botId:'b',ownerId:1,run:'run',sendBudget:3});g.allowQuery('q');
  g.before('b','answerGuestQuery',{guest_query_id:'q'});g.before('b','answerGuestQuery',{guest_query_id:'q'});g.before('b','answerGuestQuery',{guest_query_id:'q'});
  assert.throws(()=>g.before('b','answerGuestQuery',{guest_query_id:'q'}),/budget/i);
});
test('manual runner releases its shared lock and closes the runtime after a failed stage',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-acceptance-')),file=path.join(root,'config.json');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(file,JSON.stringify(config));let closed=false;
  await assert.rejects(runGuestAcceptance({argv:['--config',file,'--case','routing','--state-dir',path.join(root,'state')],createRuntime:async()=>({run:async()=>{throw new Error('Stage failed');},close:async()=>{closed=true;}}),log:()=>{}}),/Stage failed/);
  assert.equal(closed,true);assert.equal(fs.existsSync(path.join(root,'inline-calibration.lock')),false);
  await assert.rejects(runGuestAcceptance({argv:['--config',file,'--duration-seconds','601'],createRuntime:()=>assert.fail('Must not start')}),/duration/i);
});
