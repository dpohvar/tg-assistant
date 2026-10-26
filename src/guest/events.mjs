import {shortMessage} from '../telegram/short-message.mjs';

export function guestMentionNames(message) {
  const names=[];
  const text=message.text??message.caption??'';
  for(const entity of message.entities??message.caption_entities??[])
    if(entity.type==='mention'){
      const value=text.slice(entity.offset,entity.offset+entity.length);
      if(value.startsWith('@'))names.push(value.slice(1).toLowerCase());
    }
  function rich(value) {
    if(!value||typeof value!=='object')return;
    if(value.type==='mention'&&typeof value.username==='string')names.push(value.username.replace(/^@/,'').toLowerCase());
    for(const [key,item] of Object.entries(value))if(!['reply_to_message','external_reply','quote','reference_messages','message','user'].includes(key))rich(item);
  }
  rich(message.rich_message);
  return names;
}

export function explicitGuestMention(message,bot,activeUsernames) {
  if(!bot?.username)return false;
  const active=activeUsernames??new Set([bot.username.toLowerCase().replace(/^@/,'')]);
  return guestMentionNames(message).some(name=>active.has(name));
}

export function shortGuestMessage(message,guestRequestId) {
  const event=shortMessage(message,'guest_message');
  for(const key of ['messageId','replyTo','topicId','topicUnknown','albumId'])delete event[key];
  return {...event,guestRequestId,chatType:message.chat.type,...(message.chat.title?{chatTitle:message.chat.title}:{})};
}

export function createGuestEvents({store,getBot,getActiveUsernames,resolveActor,enqueue,isKnownMember=()=>false,onError=()=>{}}) {
  function isCurrent(scope,id) {
    try {
      const req=store.get(scope,id),actor=resolveActor(scope.botId,req.callerUserId);
      return Boolean(actor&&actor.agentId===scope.agentId&&!isKnownMember(scope.botId,req.message.chat));
    }catch{return false;}
  }
  return {isCurrent,
    async receive(botId,update) {
      const message=update.guest_message;
      if(!message)return false;
      if(botId==='master'||!Number.isSafeInteger(message.from?.id)||message.from.id<=0||message.sender_chat||typeof message.guest_query_id!=='string'||!message.guest_query_id||!['private','group','supergroup'].includes(message.chat?.type)||isKnownMember(botId,message.chat))return true;
      const scope=resolveActor(botId,message.from.id);if(!scope)return true;
      if(!guestMentionNames(message).length)return true;
      let active;
      try{active=await getActiveUsernames(botId);}
      catch(error){try{onError(error);}catch{}return true;}
      if(!explicitGuestMention(message,getBot(botId),active))return true;
      const {request,created}=store.record({botId,agentId:scope.agentId,callerUserId:message.from.id,updateId:update.update_id,message});
      if(created)enqueue(scope,shortGuestMessage(message,request.guestRequestId),()=>isCurrent(scope,request.guestRequestId));
      return true;
    },
  };
}
