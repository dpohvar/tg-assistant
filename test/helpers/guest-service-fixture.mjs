import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createAccess} from '../../src/access/scope.mjs';
import {createInlineStore} from '../../src/inline/store.mjs';
import {createGuestStore} from '../../src/guest/store.mjs';
import {createGuestReceipts} from '../../src/guest/receipts.mjs';
import {createGuestService} from '../../src/guest/service.mjs';
import {guestMessage} from './guest-fixture.mjs';
export function guestServiceFixture(t,{effect}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-service-')),db=openDatabase(':memory:');
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});const scope=db.ensureAgent('b',1);
  const store=createGuestStore(db,{now:()=>1000}),inlineStore=createInlineStore(db,{now:()=>1000}),receipts=createGuestReceipts({directory:root,now:()=>1000}),calls=[];
  const req=store.record({botId:'b',agentId:scope.agentId,callerUserId:1,updateId:1,message:guestMessage()}).request;
  let sequence=0,available=true;
  const options={store,inlineStore,receipts,db,now:()=>1000,access:createAccess(db),assertCurrent:()=>{if(!available)throw Object.assign(new Error('Unavailable'),{code:'agent_unavailable'});},resolveActor:()=>available?scope:null,telegram:{call:async(botId,method,args)=>{calls.push({botId,method,args});return effect?effect(botId,method,args):{inline_message_id:'inline-'+(++sequence)};}}};
  const service=createGuestService(options);
  return {root,db,scope,store,inlineStore,receipts,calls,req,options,service,setAvailable:value=>{available=value;}};
}
