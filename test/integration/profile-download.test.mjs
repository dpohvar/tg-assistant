import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownload } from '../../src/files/download.mjs';
import { filterChatInfo } from '../../src/telegram/chat-info.mjs';
test('chat profiles expose public fields but gate private content and admin fields', () => {
 const chat={id:2,type:'private',first_name:'Igor',bio:'hi',photo:{big_file_id:'pic'},invite_link:'secret',pinned_message:{text:'secret'},guard_bot:{id:8},future_secret:'hidden'};
 const profile=filterChatInfo(chat,false); assert.equal(profile.bio,'hi');assert.deepEqual(profile.photo,chat.photo);
 for(const field of ['invite_link','pinned_message','guard_bot','future_secret'])assert.equal(profile[field],undefined);
 const allowed=filterChatInfo(chat,true);assert.equal(allowed.invite_link,'secret');assert.deepEqual(allowed.pinned_message,chat.pinned_message);assert.equal(allowed.future_secret,undefined);
});
test('download accepts arbitrary file IDs, caches concurrent fetches and isolates per-file failures', async()=>{
 const saved=new Map();let calls=0,fetches=0;
 const d=createDownload({filesFor:()=>({root:'/wiki',read:p=>{if(!saved.has(p))throw Object.assign(new Error(),{code:'ENOENT'});return saved.get(p);},write:(p,v)=>saved.set(p,v)}),getToken:()=> 'test',telegram:{async call(_b,_m,{file_id}){calls++;if(file_id==='bad')throw new Error();await new Promise(r=>setTimeout(r,10));return{file_path:'photos/a.jpg'};}},fetch:async()=>{fetches++;return{ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer};}});
 const scope={botId:'b',agentId:'a'};
 const [a,b]=await Promise.all([d(scope,{fileIds:['arbitrary','bad']}),d(scope,{fileIds:['arbitrary']})]);
 assert.equal(a.files[0].fileId,'arbitrary');assert.equal(a.files[0].path,b.files[0].path);assert.equal(a.files[1].error,'file_unavailable');assert.equal(fetches,1);assert.equal(calls,2);
 await d(scope,{fileIds:['arbitrary']});assert.equal(calls,2);
 assert.equal((await d(scope,{fileIds:[null]})).error,'invalid_argument');
});
