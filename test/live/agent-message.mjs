// Bounded replay of an existing authorized interagent request. Stop normal polling first.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {openDatabase} from '../../src/storage/database.mjs';
import {createTelegram} from '../../src/telegram/api.mjs';
import {createController} from '../../src/controller.mjs';
import {CodexAgent} from '../../src/codex/threads.mjs';
const [configFile, requestId] = process.argv.slice(2), config=JSON.parse(fs.readFileSync(configFile,'utf8'));
assert(!fs.existsSync(path.join(config.dataDir,'controller.lock')), 'Stop the service before running this replay.');
const db=openDatabase(path.join(config.dataDir,'controller.sqlite'));
const request=db.sql.prepare('SELECT * FROM agent_messages WHERE id=?').get(Number(requestId)); assert(request);
const sender=db.sql.prepare('SELECT * FROM agents WHERE agentId=? AND botId=?').get(request.fromAgentId,request.botId);
const recipient=db.sql.prepare('SELECT * FROM agents WHERE agentId=? AND botId=?').get(request.toAgentId,request.botId);assert(sender&&recipient);
const backend=createTelegram({getToken:id=>fs.readFileSync(db.getBot(id).secretRef,'utf8').trim()}), sent=[], failures=[];
const telegram={getToken:backend.getToken,async call(id,method,args,options){const r=await backend.call(id,method,args,options);if(method==='sendMessage')sent.push({chatId:args.chat_id,messageId:r.message_id});return r;}};
const agent=new CodexAgent({db,config}), controller=createController({db,config,telegram,agent,onError:e=>failures.push(e.code??'controller_failed')});
const timeout=setTimeout(()=>controller.close(),120000);
try {
 await controller.invoke(controller.lifecycle.scope(sender),'agent_message',{agentId:recipient.agentId,text:request.text});await controller.idle();
 assert.deepEqual(failures,[]);assert.ok(sent.some(s=>s.chatId===recipient.chatId),'No group publication');assert.ok(sent.some(s=>s.chatId===sender.chatId),'No private result');
 console.log(JSON.stringify({passed:true,sent}));
}finally{clearTimeout(timeout);controller.close();await controller.idle();db.close();}
