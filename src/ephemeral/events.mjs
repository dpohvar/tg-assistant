import {createHash} from 'node:crypto';
import {shortMessage} from '../telegram/short-message.mjs';
import {roles} from '../access/scope.mjs';
import {isEphemeral} from '../commands/replies.mjs';
export function createSayEvents({db,store,messages,telegram,queue,resolveScope,assertCurrent,isUnavailable=()=>false,onError=()=>{}}){
  const jobs=new Map();let closed=false;
  const allowed=(botId,m)=>!closed&&!isUnavailable(botId,m.chat.id)&&(roles[db.role(botId,m.from?.id)]??0)>=roles.user&&!!db.getChat(botId,m.chat.id)?.agentEnabled;
  const notify=async(botId,m,text)=>{
    try{await telegram.call(botId,'sendMessage',{chat_id:m.chat.id,text,...(isEphemeral(m)?{ephemeral_message_parameters:{receiver_user_id:m.from.id},reply_parameters:{ephemeral_message_id:m.ephemeral_message_id}}:{reply_parameters:{message_id:m.message_id}})});}catch{}
  };
  async function receive(botId,m){
    if(closed)return true;
    const bot=db.getBot(botId);
    if(botId==='master'||!bot||m.edit_date!==undefined||m.sender_chat||m.from?.is_bot)return true;
    if(!['group','supergroup'].includes(m.chat.type)||!isEphemeral(m)||!Number.isSafeInteger(m.ephemeral_message_id)||m.ephemeral_message_id<=0||m.receiver_user?.id!==bot.telegramId){await notify(botId,m,'Use /say as an ephemeral command in a group. Direct messages are already private.');return true;}
    if((roles[db.role(botId,m.from?.id)]??0)<roles.user){await notify(botId,m,'Access denied. /say requires user role or higher.');return true;}
    if(!db.getChat(botId,m.chat.id)||!db.getChat(botId,m.chat.id).agentEnabled){await notify(botId,m,'The chat agent is disabled or unavailable.');return true;}
    const prefix=/^\/say(?:@[\w]+)?(?:\s+|$)/i.exec(m.text??'');if(!prefix)return true;
    const start=prefix[0].length,end=m.text.trimEnd().length,text=m.text.slice(start,end);
    if(!text){await notify(botId,m,'Usage: /say MESSAGE');return true;}
    const entities=(m.entities??[]).filter(e=>e.type!=='bot_command'&&Number.isInteger(e.offset)&&Number.isInteger(e.length)&&e.offset<end&&e.offset+e.length>start).map(e=>({...e,offset:Math.max(e.offset,start)-start,length:Math.min(e.offset+e.length,end)-Math.max(e.offset,start)})).filter(e=>e.length>0);
    const normalized={...m,text,entities},scope=resolveScope(db.ensureAgent(botId,m.chat.id));
    if(!queue.canAccept(scope.agentId)){await notify(botId,m,'The agent queue is full. Try again later.');return true;}
    let saved;
    try{saved=store.record(scope,normalized,{direction:'incoming',signature:createHash('sha256').update(JSON.stringify(m)).digest('hex')}).record;}catch(error){onError(error);return true;}
    if(saved.queued)return true;
    const source={ephemeralMessageId:m.ephemeral_message_id};let preparation=saved.eventState;
    if(!preparation){
      // Persist intent before the external send; a restart must not resend an uncertain preparation.
      store.setEventState(scope,source,{replyPreparationError:{error:'delivery_unknown',description:'Preparation was interrupted; do not resend automatically.'}});
      try{
        const result=await messages.send(scope,{text:'Request received.',reply_parameters:{ephemeral_message_id:m.ephemeral_message_id}});
        preparation=result.error?{replyPreparationError:{error:result.error,description:result.description}}:{preparedReply:result};
      }catch(error){preparation={replyPreparationError:{error:error.code??'preparation_failed',description:'The private response could not be prepared.'}};}
      store.setEventState(scope,source,preparation);
    }
    const current=()=>{try{assertCurrent(scope);store.get(scope,source);return allowed(botId,m);}catch{return false;}};
    const {messageId,...content}=shortMessage(normalized);
    const event={...content,...(content.replyTo===0?{replyTo:undefined}:{}),ephemeralMessageId:m.ephemeral_message_id,triggers:['/say'],...preparation};
    if(!current()||queue.enqueueCommitted(scope.agentId,event,'chat',current,()=>store.markQueued(scope,source))!=='accepted'){
      if(preparation.preparedReply&&!closed)try{await messages.delete(scope,preparation.preparedReply);}catch{}
    }
    return true;
  }
  return {
    receive(botId,message){const key=`${botId}:${message.chat.id}:${message.ephemeral_message_id??message.message_id}`;if(jobs.has(key))return jobs.get(key);const work=receive(botId,message).finally(()=>jobs.delete(key));jobs.set(key,work);return work;},
    close(){closed=true;},
    async idle(){while(jobs.size)await Promise.allSettled([...jobs.values()]);},
  };
}
