import test from 'node:test';
import assert from 'node:assert/strict';
import {createInlineAvatars} from '../../src/inline/avatars.mjs';
const photo=id=>({total_count:1,photos:[[{file_id:id,width:640,height:640}]]});

test('own avatar has priority, caches across requests and refreshes after five minutes',async()=>{
  let now=0;const calls=[];
  const avatars=createInlineAvatars({now:()=>now,getBot:()=>({telegramId:42}),getMasterId:()=>99,telegram:{call:async(botId,method,args,options)=>{
    calls.push({botId,method,args});assert.ok(options.signal instanceof AbortSignal);return photo('own-'+calls.length);
  }}});
  assert.equal(await avatars.get('child'),'own-1');assert.equal(await avatars.get('child'),'own-1');assert.equal(calls.length,1);
  now=300000;assert.equal(await avatars.get('child'),'own-2');
  assert.deepEqual(calls.map(c=>[c.botId,c.method,c.args]),[['child','getUserProfilePhotos',{user_id:42,limit:1}],['child','getUserProfilePhotos',{user_id:42,limit:1}]]);
  avatars.close();
});

test('master avatar is obtained separately through each child token and an absent fallback stays null',async()=>{
  const calls=[];
  const avatars=createInlineAvatars({getBot:id=>({telegramId:id==='a'?42:43}),getMasterId:()=>99,telegram:{call:async(botId,_method,{user_id})=>{
    calls.push([botId,user_id]);return user_id===99?photo(botId+'-master'):{photos:[]};
  }}});
  assert.equal(await avatars.get('a'),'a-master');assert.equal(await avatars.get('b'),'b-master');
  assert.deepEqual(calls,[['a',42],['a',99],['b',43],['b',99]]);avatars.close();
  const empty=createInlineAvatars({getBot:()=>({telegramId:42}),getMasterId:()=>99,telegram:{call:async()=>({photos:[]})}});
  assert.equal(await empty.get('a'),null);empty.close();
});

test('profile errors fall back silently and concurrent lookups are shared',async()=>{
  let resolve;const calls=[];const master=new Promise(r=>{resolve=r;});
  const avatars=createInlineAvatars({getBot:()=>({telegramId:42}),getMasterId:()=>99,telegram:{call:async(botId,_method,{user_id})=>{
    calls.push([botId,user_id]);if(user_id===42)throw new Error('Unavailable');return master;
  }}});
  const first=avatars.get('child'),second=avatars.get('child');resolve(photo('master'));
  assert.deepEqual(await Promise.all([first,second]),['master','master']);assert.equal(calls.length,2);
  assert.equal(await avatars.get('child'),'master');assert.equal(calls.length,2);avatars.close();
});

test('unknown bots cause no profile lookup and negative results expire too',async()=>{
  let now=0,calls=0;const avatars=createInlineAvatars({now:()=>now,getBot:id=>id==='unknown'?null:{telegramId:42},telegram:{call:async()=>{calls++;throw new Error('Unavailable');}}});
  assert.equal(await avatars.get('unknown'),null);assert.equal(calls,0);
  assert.equal(await avatars.get('child'),null);assert.equal(await avatars.get('child'),null);assert.equal(calls,1);
  now=300000;assert.equal(await avatars.get('child'),null);assert.equal(calls,2);avatars.close();
});

test('forget and shutdown abort pending reads without looking up the master or reviving the cache',async()=>{
  const calls=[];const avatars=createInlineAvatars({getBot:()=>({telegramId:42}),getMasterId:()=>99,telegram:{call:(_bot,_method,{user_id},{signal})=>{
    calls.push(user_id);return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
  }}});
  const first=avatars.get('child');avatars.forget('child');assert.equal(await first,null);
  const second=avatars.get('child');avatars.close();assert.equal(await second,null);assert.equal(await avatars.get('child'),null);
  assert.deepEqual(calls,[42,42]);
});
