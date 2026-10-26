import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createCommands} from '../../src/commands/router.mjs';

test('a widget command accepts any current bot username and rejects other or revoked names', async t => {
  const db=openDatabase(':memory:');
  t.after(()=>db.close());
  db.registerBot({botId:'child',telegramId:42,username:'old_primary',ownerId:1});
  const calls=[];
  const telegram={call:async(_bot,method,args)=>{
    calls.push({method,args});
    if(method==='getChat'){
      assert.equal(args.chat_id,42);
      return {id:42,username:'new_primary',active_usernames:['new_primary','secondary']};
    }
    return {message_id:100};
  }};
  const commands=createCommands({db,telegram,widgets:{store:{list:()=>[]}}});
  t.after(()=>commands.close());
  const message=text=>({message_id:7,chat:{id:1,type:'private'},from:{id:1},text});
  assert.equal(await commands.handle('child',message('/widget@secondary list')),true);
  assert(calls.some(call=>call.method==='sendMessage'));
  calls.length=0;
  assert.equal(await commands.handle('child',message('/widget@new_primary list')),true);
  assert(calls.some(call=>call.method==='sendMessage'));
  calls.length=0;
  assert.equal(await commands.handle('child',message('/widget@other_bot list')),false);
  assert.equal(await commands.handle('child',message('/widget@old_primary list')),false);
  assert.equal(calls.filter(call=>call.method==='sendMessage').length,0);
});

test('hidden /say accepts an additional active username', async t => {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  db.registerBot({botId:'child',telegramId:42,username:'primary',ownerId:1});
  const delivered=[];
  const commands=createCommands({db,telegram:{call:async(_bot,method)=>{
    assert.equal(method,'getChat');
    return {id:42,username:'primary',active_usernames:['primary','secondary']};
  }},say:async(_bot,message)=>{delivered.push(message.text);return true;}});
  t.after(()=>commands.close());
  const message=text=>({message_id:0,ephemeral_message_id:5,receiver_user:{id:42},date:100,chat:{id:-1,type:'supergroup'},from:{id:1},text});
  assert.equal(await commands.handle('child',message('/say@secondary hello')),true);
  assert.deepEqual(delivered,['/say@secondary hello']);
});
