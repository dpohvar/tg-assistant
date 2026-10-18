// Passive Bot API capability probe. No agent, database writes, group sends or message edits.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createTelegram} from '../../src/telegram/api.mjs';
import {acquireLock} from '../../src/service/lock.mjs';

export function classifyProbeUpdate(update,{ownerId,botTelegramId,marker,callbackData}){
  const q=update.inline_query;
  if(q?.from?.id===ownerId)return {type:'inline_query',chatType:q.chat_type};
  const cb=update.callback_query;
  if(cb?.from?.id===ownerId&&cb.data===callbackData)return {type:'placement_callback',inlineMessageId:cb.inline_message_id,hasOrdinaryMessage:Boolean(cb.message)};
  const m=update.message??update.edited_message;
  if(m?.from?.id===ownerId){
    const fixture=message=>message?.text===marker&&message.via_bot?.id===botTelegramId;
    const address={route:m.chat.id===ownerId?'private':'group',chatId:m.chat.id,messageId:m.message_id};
    if(fixture(m))return {type:'fixture_message',...address};
    if(fixture(m.reply_to_message))return {type:'fixture_reply',...address,replyTo:m.reply_to_message.message_id};
    if(m.chat.id===ownerId&&['/events status','/events stop'].includes(m.text))return {type:'command',command:m.text};
  }
  const reaction=update.message_reaction;
  if(reaction?.user?.id===ownerId)return {type:'reaction_candidate',route:reaction.chat.id===ownerId?'private':'group',chatId:reaction.chat.id,messageId:reaction.message_id};
  if(update.message_reaction_count)return {type:'anonymous_reaction_candidate'};
  const member=update.my_chat_member;
  if(member?.from?.id===ownerId&&member.new_chat_member?.user?.id===botTelegramId)return {type:'membership_change',chatId:member.chat.id,status:member.new_chat_member.status};
  return null;
}

export async function runInlineEventsProbe({argv=process.argv.slice(2),signal,log=e=>console.log(JSON.stringify({at:Date.now(),...e}))}={}){
  const {values}=parseArgs({args:argv,options:{config:{type:'string'},'duration-seconds':{type:'string',default:'1200'}}});
  if(!values.config)throw new Error('Explicit private config is required.');
  const duration=Number(values['duration-seconds']);if(!Number.isSafeInteger(duration)||duration<1||duration>1800)throw new Error('Invalid duration.');
  const file=path.resolve(values.config),config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(config.controllerActive||!Number.isSafeInteger(config.ownerId)||!Number.isSafeInteger(config.botTelegramId))throw new Error('Invalid designated identity.');
  const release=acquireLock(path.join(path.dirname(file),'inline-calibration.lock'));
  const token=config.token??fs.readFileSync(config.tokenFile,'utf8').trim(),telegram=createTelegram({getToken:()=>token}),botId='inline-events-probe';
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),duration*1000),stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const suffix=randomUUID().slice(0,8),marker='Inline events probe '+suffix,callbackData='events:'+randomUUID().replaceAll('-','');
  const context={ownerId:config.ownerId,botTelegramId:config.botTelegramId,marker,callbackData};
  const counts={placementCallbacks:0,privateMessages:0,groupMessages:0,privateReplies:0,groupReplies:0,privateReactionCandidates:0,groupReactionCandidates:0,anonymousReactionCandidates:0,membershipChanges:0,pollCycles:0,ownerGroupMessagesSeen:0,ownerGroupRepliesSeen:0,transportCounts:{}};
  const seen=new Set(),stopFile=path.join(path.dirname(file),'stop-inline-events');let effects=0;
  const effect=async(method,args)=>{if(++effects>200)throw new Error('Probe effect budget exceeded');return telegram.call(botId,method,args,{signal:abort.signal});};
  try{
    const me=await telegram.call(botId,'getMe',{}, {signal:abort.signal});
    if(me.id!==config.botTelegramId||me.username!=='dpohvar_test_pub_bot'||!me.supports_inline_queries)throw new Error('Designated inline bot mismatch.');
    if((await telegram.call(botId,'getWebhookInfo',{}, {signal:abort.signal})).url)throw new Error('Webhook is active.');
    const allowed=['inline_query','callback_query','message','edited_message','message_reaction','message_reaction_count','my_chat_member'];
    const result={type:'article',id:'events-'+suffix,title:marker,description:'Post, press Confirm placement, then reply and react.',input_message_content:{message_text:marker},reply_markup:{inline_keyboard:[[{text:'Confirm placement',callback_data:callbackData}]]}};
    await telegram.call(botId,'savePreparedInlineMessage',{user_id:config.ownerId,allow_user_chats:true,result},{signal:abort.signal});
    const backlog=await telegram.call(botId,'getUpdates',{offset:-1,timeout:0,allowed_updates:allowed},{signal:abort.signal});let offset=backlog.at(-1)?.update_id+1;
    log({type:'ready',botUsername:me.username,marker,durationSeconds:duration,allowedUpdates:allowed});
    while(!abort.signal.aborted&&!fs.existsSync(stopFile)){
      const updates=await telegram.call(botId,'getUpdates',{offset,timeout:15,allowed_updates:allowed},{signal:abort.signal});counts.pollCycles++;
      for(const update of updates){
        offset=update.update_id+1;if(seen.has(update.update_id))continue;seen.add(update.update_id);
        const kinds=Object.keys(update).filter(k=>k!=='update_id');for(const kind of kinds)counts.transportCounts[kind]=(counts.transportCounts[kind]??0)+1;
        const message=update.message??update.edited_message,ownerGroup=message?.from?.id===config.ownerId&&message.chat.id!==config.ownerId;
        if(ownerGroup){counts.ownerGroupMessagesSeen++;if(message.reply_to_message)counts.ownerGroupRepliesSeen++;}
        log({type:'transport_update',kinds,...(ownerGroup?{ownerGroupMessage:true,hasReply:Boolean(message.reply_to_message)}:{})});
        // Observe before any private-chat admission policy: a genuine group reply must not be filtered away.
        const observation=classifyProbeUpdate(update,context);if(!observation)continue;
        if(observation.type==='command'){
          log({type:'summary',...counts});if(observation.command==='/events stop')return;
          await effect('sendMessage',{chat_id:config.ownerId,disable_notification:true,text:`Probe ${suffix}\nCallbacks: ${counts.placementCallbacks}\nReplies: private=${counts.privateReplies}, group=${counts.groupReplies}\nReaction candidates: private=${counts.privateReactionCandidates}, group=${counts.groupReactionCandidates}, anonymous=${counts.anonymousReactionCandidates}\nRaw owner-group messages/replies: ${counts.ownerGroupMessagesSeen}/${counts.ownerGroupRepliesSeen}\nMembership changes: ${counts.membershipChanges}\nPoll cycles: ${counts.pollCycles}`});continue;
        }
        log(observation);
        if(observation.type==='inline_query')await effect('answerInlineQuery',{inline_query_id:update.inline_query.id,results:update.inline_query.offset?[]:[result],next_offset:'',cache_time:0,is_personal:true});
        if(observation.type==='placement_callback'){counts.placementCallbacks++;await effect('answerCallbackQuery',{callback_query_id:update.callback_query.id,text:'Probe click received'});}
        if(observation.type==='fixture_message')counts[observation.route==='private'?'privateMessages':'groupMessages']++;
        if(observation.type==='fixture_reply')counts[observation.route==='private'?'privateReplies':'groupReplies']++;
        if(observation.type==='reaction_candidate')counts[observation.route==='private'?'privateReactionCandidates':'groupReactionCandidates']++;
        if(observation.type==='anonymous_reaction_candidate')counts.anonymousReactionCandidates++;
        if(observation.type==='membership_change')counts.membershipChanges++;
      }
    }
  }catch(error){if(!abort.signal.aborted)throw error;}
  finally{log({type:'summary',...counts});abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop);release();log({type:'stopped'});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  runInlineEventsProbe({signal:abort.signal}).catch(error=>{console.error(JSON.stringify({type:'probe_failed',code:error.code??'probe_failed',description:String(error.message).replace(/bot\d+:[\w-]+/g,'bot[redacted]').slice(0,250)}));process.exitCode=1;});
}
