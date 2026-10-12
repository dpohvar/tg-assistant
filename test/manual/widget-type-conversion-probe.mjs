// Bounded, opt-in live Telegram probe. Only new private test messages are edited/deleted.
// Usage: node test/manual/widget-type-conversion-probe.mjs TOKEN_FILE CHAT_ID OUTPUT_DIR [extra]
// TOKEN_FILE's directory supplies telegram-album-21.jpg and, for extra, animation.gif.
// Public audio/video fixtures are downloaded. Raw results stay in the ignored output directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createTelegram} from '../../src/telegram/api.mjs';
const [tokenFile, chatArg, outputDir, mode] = process.argv.slice(2);
if (!tokenFile || !chatArg || !outputDir) throw new Error('Missing probe arguments');
const token = (await fs.readFile(tokenFile,'utf8')).trim();
const api = createTelegram({getToken:()=>token});
const call = (method,args={},uploads=[])=>api.call('probe',method,args,{uploads,signal:AbortSignal.timeout(30000)});
const me=await call('getMe');
if(me.username!=='dpohvar_test_pub_bot')throw new Error('Expected the designated test bot');
const chatId=Number(chatArg), chat=await call('getChat',{chat_id:chatId});
if(chat.type!=='private')throw new Error('Probe requires a private test chat');
await fs.mkdir(outputDir,{recursive:true});
const results=[], created=[];
const delay=()=>new Promise(r=>setTimeout(r,250));
const type=m=>['rich_message','photo','video','animation','audio','document','voice','video_note','sticker','location','venue','contact','poll','dice','text'].find(k=>m[k]!==undefined)??'unknown';
const photo=await fs.readFile(path.join(path.dirname(tokenFile),'telegram-album-21.jpg'));
async function fixture(url){const res=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!res.ok)throw new Error('Fixture download failed');return new Uint8Array(await res.arrayBuffer());}
const mp4=await fixture('https://www.w3schools.com/html/mov_bbb.mp4');
const mp3=await fixture('https://www.w3schools.com/html/horse.mp3');
const files={photo:{name:'file',bytes:photo,filename:'probe.jpg',mime:'image/jpeg'},video:{name:'file',bytes:mp4,filename:'probe.mp4',mime:'video/mp4'},audio:{name:'file',bytes:mp3,filename:'probe.mp3',mime:'audio/mpeg'},document:{name:'file',bytes:Buffer.from('Widget conversion probe'),filename:'probe.txt',mime:'text/plain'}};
if(mode==='extra')files.animation={name:'file',bytes:await fs.readFile(path.join(path.dirname(tokenFile),'animation.gif')),filename:'probe.gif',mime:'image/gif'};
const refs={};
async function send(kind){
 const common={chat_id:chatId,disable_notification:true};
 const methods={photo:'sendPhoto',video:'sendVideo',audio:'sendAudio',document:'sendDocument',animation:'sendAnimation'};
 let m;
 if(kind==='text')m=await call('sendMessage',{...common,text:'WIDGET TYPE PROBE: text'});
 else if(kind==='rich_message')m=await call('sendRichMessage',{...common,rich_message:{html:'<p>WIDGET TYPE PROBE: <b>rich</b></p>'}});
 else if(kind==='voice')m=await call('sendVoice',{...common,voice:'attach://file'},[files.audio]);
 else if(kind==='dice')m=await call('sendDice',{...common,emoji:'🎲'});
 else if(kind==='poll')m=await call('sendPoll',{...common,question:'WIDGET TYPE PROBE',options:[{text:'A'},{text:'B'}]});
 else if(kind==='location')m=await call('sendLocation',{...common,latitude:0,longitude:0});
 else if(kind==='venue')m=await call('sendVenue',{...common,latitude:0,longitude:0,title:'Probe',address:'Test fixture'});
 else if(kind==='contact')m=await call('sendContact',{...common,phone_number:'+10000000000',first_name:'Probe'});
 else m=await call(methods[kind],{...common,[kind]:refs[kind]??'attach://file'},refs[kind]?[]:[files[kind]]);
 created.push(m.message_id);
 if(files[kind]){if(!m[kind])throw new Error(`Fixture returned ${type(m)} instead of ${kind}`);refs[kind]=kind==='photo'?m.photo.at(-1).file_id:m[kind].file_id;}
 await delay();return m;
}
async function attempt(from,to){
 let m;
 try{m=await send(from);}catch(e){results.push({from,to,phase:'creation',error:e.message});return;}
 const method=to==='text'||to==='rich_message'?'editMessageText':'editMessageMedia';
 const args={chat_id:chatId,message_id:m.message_id};
 if(to==='text')args.text='WIDGET TYPE PROBE: converted to text';
 else if(to==='rich_message')args.rich_message={html:'<p>WIDGET TYPE PROBE: converted to <b>rich</b></p>'};
 else args.media={type:to,media:refs[to],caption:'WIDGET TYPE PROBE: converted media'};
 try{const edited=await call(method,args);results.push({from,to,method,ok:true,actualType:type(edited),sameMessageId:edited.message_id===m.message_id});}
 catch(e){results.push({from,to,method,ok:false,error:e.message});}
 console.log(JSON.stringify(results.at(-1)));await delay();
}
try{
 for(const kind of Object.keys(files))await send(kind);
 const kinds=['text','rich_message','photo','video','audio','document'];
 if(mode==='extra'){
  for(const kind of kinds){await attempt(kind,'animation');await attempt('animation',kind);}
  await attempt('venue','photo');
  for(const from of ['location','venue']){
   const m=await send(from), method='editMessageLiveLocation';
   try{const edited=await call(method,{chat_id:chatId,message_id:m.message_id,latitude:1,longitude:1,live_period:60});results.push({from,to:'live_location',method,ok:true,actualType:type(edited),livePeriod:edited.location?.live_period});}
   catch(e){results.push({from,to:'live_location',method,ok:false,error:e.message});}
   console.log(JSON.stringify(results.at(-1)));await delay();
  }
 }else{
  for(const from of kinds)for(const to of kinds)if(from!==to)await attempt(from,to);
  for(const from of ['voice','dice','poll','location','contact'])await attempt(from,'photo');
 }
}finally{
 for(const message_id of created){try{await call('deleteMessage',{chat_id:chatId,message_id});}catch(e){results.push({phase:'cleanup',messageId:message_id,error:e.message});}await delay();}
 await fs.writeFile(path.join(outputDir,'results.json'),JSON.stringify({at:new Date().toISOString(),bot:me.username,results},null,2));
 console.log(JSON.stringify({finished:true,attempts:results.filter(x=>x.method).length,cleanupFailures:results.filter(x=>x.phase==='cleanup').length}));
}
