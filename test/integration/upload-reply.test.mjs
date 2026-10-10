import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createCommands} from '../../src/commands/router.mjs';
for(const name of ['rules set','upload'])for(const direction of ['file-replies-command','command-replies-file'])for(const invalid of ['foreign','edited','other-chat']){
 test(`${name} rejects ${invalid} reply target (${direction})`,async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});let writes=0;const replies=[];
  const router=createCommands({db,config:{dataDir:"."},telegram:{call:async(_b,_method,args)=>replies.push(args)},updateRules:async()=>writes++,fileCommands:async()=>{writes++;return 'saved';}});
  const quote={message_id:1,chat:{id:1,type:'private'},from:{id:invalid==='foreign'?2:1},...(invalid==='edited'?{edit_date:123}:{}),...(direction==='file-replies-command'?{text:`/${name}${name==='upload'?' file.txt':''}`}:{document:{file_id:'file'}})};
  if(invalid==='other-chat')quote.chat.id=2;
  const message={message_id:2,chat:{id:1,type:'private'},from:{id:1},reply_to_message:quote,...(direction==='file-replies-command'?{document:{file_id:'file'}}:{text:`/${name}${name==='upload'?' file.txt':''}`})};
  assert.equal(await router.handle('b',message),true);assert.equal(writes,0);assert.equal(replies.length,1);assert.equal(replies[0].reply_parameters.message_id,2);
  assert.match(replies[0].text,invalid==='edited'?/edited/:invalid==='foreign'?/your own/:/current chat/);
 });
}
for(const name of ['rules set','upload'])for(const direction of ['file-replies-command','command-replies-file'])test(`${name} accepts own unedited target (${direction})`,async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});let writes=0;
 const router=createCommands({db,config:{dataDir:"."},telegram:{call:async()=>({})},updateRules:async()=>writes++,fileCommands:async()=>{writes++;return 'saved';}});
 const quote={message_id:1,chat:{id:1,type:'private'},from:{id:1},...(direction==='file-replies-command'?{text:`/${name}${name==='upload'?' file.txt':''}`}:{document:{file_id:'file'}})};
 const message={message_id:2,chat:quote.chat,from:{id:1},reply_to_message:quote,...(direction==='file-replies-command'?{document:{file_id:'file'}}:{text:`/${name}${name==='upload'?' file.txt':''}`})};
 assert.equal(await router.handle('b',message),true);assert.equal(writes,1);
});
