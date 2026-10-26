// Opt-in acceptance helper: real model tools against the migrated legacy registration.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CodexAgent} from '../../src/codex/threads.mjs';
import {sourceHashes} from '../helpers/wordle-fixture.mjs';

export async function verifyNativeManagement({filename,root,db,service,scope,widgetId,signal,report}){
  const privateConfig=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!privateConfig.codexHome||!privateConfig.codexExecutable)throw new Error('Explicit native model configuration is required.');
  const config={dataDir:path.join(root,'data'),botsDir:path.join(root,'bots'),codexHome:path.join(root,'native-home'),codexExecutable:privateConfig.codexExecutable,defaultTimezone:'UTC'};
  fs.mkdirSync(config.codexHome,{recursive:true});
  if(!fs.existsSync(path.join(config.codexHome,'auth.json')))fs.copyFileSync(path.join(privateConfig.codexHome,'auth.json'),path.join(config.codexHome,'auth.json'));
  const rules=path.join(config.dataDir,'rules',scope.botId);fs.mkdirSync(rules,{recursive:true});
  fs.writeFileSync(path.join(rules,'AGENTS.md'),'Isolated acceptance fixture. Never spawn subagents, send messages, change files or use tools other than list_widgets, get_widget, update_widget. Follow the explicit acceptance instruction. No game source edits.');
  const workspace=path.join(config.botsDir,scope.botId),hashes=sourceHashes(workspace),identity=db.agent(scope.botId,scope.chatId).agentId;
  const agent=new CodexAgent({db,config}),calls=[];let count=0,updates=0;
  const invoke=async(name,args)=>{
    if(++count>12)throw new Error('Native acceptance tool budget exceeded');
    if(!['list_widgets','get_widget','update_widget'].includes(name))throw new Error('Tool outside migration acceptance scope');
    if(name!=='list_widgets'&&args.widgetId!==widgetId)throw new Error('Foreign widget');
    if(name==='update_widget'&&(Object.keys(args).some(k=>k!=='widgetId')||++updates>1))throw new Error('Only one empty update is permitted');
    const before=structuredClone(service.store.get(widgetId).state);
    const result=await (name==='list_widgets'?service.list(scope):name==='get_widget'?service.get(scope,args):service.update(scope,args));
    if(name==='list_widgets')assert.ok(result.items.some(w=>w.widgetId===widgetId));
    if(name==='get_widget')assert.equal(result.widgetId,widgetId);
    if(name==='update_widget')assert.deepEqual(service.store.get(widgetId).state,before);
    calls.push(name);report({type:'native_migration_tool',tool:name,success:true});return result;
  };
  const stop=()=>{void agent.close();},timer=setTimeout(stop,90000);signal.addEventListener('abort',stop,{once:true});
  try{
    const result=await agent.run(scope,[{eventType:'acceptance',text:`Find the existing Wordle using list_widgets, call get_widget for ${widgetId}, then update_widget with ONLY widgetId to repaint it without resetting state or replacing its handler. Do not create anything. Finish when the tools succeed.`}],invoke);
    await result?.settled;
    for(const name of ['list_widgets','get_widget','update_widget'])assert.ok(calls.includes(name),`Missing actual ${name} call`);
    const saved=structuredClone(service.store.get(widgetId).state),views=service.store.listViews(widgetId).map(v=>v.id);
    const oldThread=db.agent(scope.botId,scope.chatId).threadId;assert.ok(oldThread);
    await agent.deleteSession(scope.agentId,oldThread);
    db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE agentId=?').run(scope.agentId);
    const refreshed=await agent.session(scope,invoke);
    assert.notEqual(refreshed.threadId,oldThread);
    assert.equal(db.agent(scope.botId,scope.chatId).threadId,null);
    assert.equal(db.agent(scope.botId,scope.chatId).agentId,identity);
    assert.deepEqual(service.store.get(widgetId).state,saved);
    assert.deepEqual(service.store.listViews(widgetId).map(v=>v.id),views);
    assert.deepEqual(sourceHashes(workspace),hashes);
    report({type:'native_migration_complete',tools:calls,sessionResetPreservedWidget:true,archiveUnchanged:true});
  }finally{clearTimeout(timer);signal.removeEventListener('abort',stop);await agent.close();}
}
