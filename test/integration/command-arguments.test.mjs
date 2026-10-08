import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../../src/commands/arguments.mjs';
test('arguments preserve code/pre and split at entity boundaries', () => {
 assert.deepEqual(parseArguments('file 1 file 2', [{type:'code',offset:7,length:6}]).map(a=>a.value), ['file','1','file 2']);
 assert.deepEqual(parseArguments('file 1file 2', [{type:'code',offset:0,length:6}]).map(a=>a.value), ['file 1','file','2']);
 assert.deepEqual(parseArguments('😀 x\ny', [{type:'pre',offset:3,length:3}]), [{type:'text',value:'😀'},{type:'pre',value:'x\ny'}]);
});
test('arguments reject unsupported formatting but allow Telegram lexical entities', () => {
 assert.throws(()=>parseArguments('hello',[{type:'bold',offset:0,length:5}]), /formatting/i);
 assert.deepEqual(parseArguments('https://a.test',[{type:'url',offset:0,length:14}]),[{type:'text',value:'https://a.test'}]);
});
import { openDatabase } from '../../src/storage/database.mjs';
import { createCommands } from '../../src/commands/router.mjs';
import { validateArguments } from '../../src/commands/arguments.mjs';
test('edit requires pre; unexpected extra arguments fail validation',()=>{
 assert.throws(()=>validateArguments('edit',[{type:'text',value:'a'},{type:'text',value:'b'}]), /pre/);
 assert.throws(()=>validateArguments('rm',[{type:'text',value:'a'},{type:'text',value:'b'}]), /Invalid arguments/);
});
test('router uses the same parser for files, master commands and quoted upload',async t=>{
 const db=openDatabase(':memory:'); t.after(()=>db.close()); db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});
 const calls=[],replies=[];
 const router=createCommands({db,config:{serviceOwnerId:1},telegram:{call:async(_b,_m,a)=>replies.push(a)},fileCommands:async(_b,n,args)=>{calls.push({n,args});return 'ok';},masterCommands:async(n,args)=>calls.push({n,args})});
 const msg=text=>({text,message_id:1,chat:{id:1,type:'private'},from:{id:1}});
 await router.handle('b',msg('/mv old.md new.md'));
 assert.deepEqual(calls.pop().args.map(a=>a.value),['old.md','new.md']);
 const quote={...msg('/upload file name.txt'),entities:[{type:'code',offset:8,length:13}]};
 await router.handle('b',{...msg(''),document:{file_id:'f'},reply_to_message:quote});
 assert.deepEqual(calls.pop().args,[{type:'code',value:'file name.txt'}]);
 await router.handle('master',{...msg('/newbot 123:abc'),entities:[{type:'code',offset:8,length:7}]});
 assert.deepEqual(calls.pop(),{n:'newbot',args:['123:abc']});
 await router.handle('b',{...msg('/rm a'),entities:[{type:'bold',offset:4,length:1}]});
 assert.equal(calls.length,0);assert.match(replies.at(-1).text,/Unsupported formatting/);
});

test('ordinary newlines split arguments; pre newlines remain intact',()=>{
 assert.deepEqual(parseArguments('one\ntwo\r\nthree\tfour').map(a=>a.value),['one','two','three','four']);
});
