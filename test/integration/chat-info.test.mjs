import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { createController } from '../../src/controller.mjs';
test('public agent information refreshes pinned messages and reaction policy without exposing foreign DM IDs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-info-')), db = openDatabase(path.join(root, 'db.sqlite'));
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 });
  for (const chat of [{ id: 1, type: 'private', first_name: 'Owner' }, { id: 2, type: 'private', first_name: 'Other' }, { id: -1, type: 'group', title: 'Old' }]) db.saveChat('b', chat);
  const own = db.ensureAgent('b', 1), other = db.ensureAgent('b', 2), group = db.ensureAgent('b', -1);
  const c = createController({ db, agent: {}, telegram: { call: async (_bot, method, args) => {
    if (method === 'getChat') return { id: args.chat_id, type: 'group', title: 'Fresh', available_reactions: [], pinned_message: { message_id: 8, date: 1000, chat: { id: -1, type: 'group' }, text: 'Pinned' } };
    if (method === 'getChatMemberCount') return 12;
    if (method === 'getChatMember') return { status: 'administrator', user: { id: 42 } };
  } } });
  t.after(() => { c.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const scope = c.lifecycle.scope(own);
  const result = await c.invoke(scope, 'agent_info', { agentIds: [group.agentId, other.agentId, 'missing'] });
  assert.equal(result.agents[0].name, 'Fresh'); assert.equal(result.agents[0].memberCount, 12);
  assert.deepEqual(result.agents[0].available_reactions, []);
  assert.equal(result.agents[0].pinned_message.date, '1970-01-01T00:16:40.000Z');
  assert.equal(result.agents[1].chatId, undefined); assert.equal(result.agents[1].userId, undefined);
  assert.equal(result.agents[2].error, 'agent_not_found');
});

test('profile metadata and user photos do not grant foreign history or create chats', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-profile-')),db=openDatabase(path.join(root,'db.sqlite'));
 db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});db.saveChat('b',{id:2,type:'private'});
 const a=db.ensureAgent('b',1), calls=[],agent={};
 const c=createController({db,agent,telegram:{call:async(_b,method,args)=>{
 calls.push({method,args});
 if(method==='getChat')return{id:args.chat_id,type:args.chat_id>0?'private':'channel',first_name:'Igor',photo:{big_file_id:'pic'},invite_link:'secret',pinned_message:{message_id:1,text:'secret'}};
 if(method==='getUserProfilePhotos')return{total_count:5,photos:[[{file_id:'p',width:640,height:640}]]};
 if(method==='getMe')return{id:42,username:'bot',first_name:'Bot'};
 if(method==='getMyDescription')return{description:'Assistant'};
 if(method==='getMyShortDescription')return{short_description:'Short assistant'};
 }}});t.after(()=>{c.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 const scope=c.lifecycle.scope(a);
 const infos=await c.invoke(scope,'chat_info',{chatIds:[2,3,-99]});
 for(const info of infos.chats){assert.equal(info.photo.big_file_id,'pic');assert.equal(info.invite_link,undefined);assert.equal(info.pinned_message,undefined);}
 assert.equal(db.getChat('b',3),null);assert.equal(db.getChat('b',-99),null);
 await assert.rejects(c.invoke(scope,'read',{chatId:2,messageIds:[1]}),/accessible/);
 const photos=await c.invoke(scope,'user_photos',{userId:3,offset:2,limit:2});assert.equal(photos.total_count,5);
 assert.deepEqual(calls.find(x=>x.method==='getUserProfilePhotos').args,{user_id:3,offset:2,limit:2});
 assert.equal((await c.invoke(scope,'user_photos',{userId:3,limit:101})).error,'invalid_argument');
 assert.deepEqual(await agent.botProfile(scope),{userId:42,username:'bot',name:'Bot',description:'Assistant',shortDescription:'Short assistant'});
});
