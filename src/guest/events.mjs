import {shortMessage} from '../telegram/short-message.mjs';

export function explicitGuestMention(message,bot) {
  if(!bot?.username)return false;
  const username=bot.username.toLowerCase().replace(/^@/,'');
  const text=message.text??message.caption??'';
  if((message.entities??message.caption_entities??[]).some(entity=>entity.type==='mention'&&text.slice(entity.offset,entity.offset+entity.length).toLowerCase()==='@'+username))return true;
  function rich(value) {
    if(!value||typeof value!=='object')return false;
    if(value.type==='mention'&&typeof value.username==='string'&&value.username.replace(/^@/,'').toLowerCase()===username)return true;
    return Object.entries(value).some(([key,item])=>!['reply_to_message','external_reply','quote','reference_messages','message','user'].includes(key)&&rich(item));
  }
  return rich(message.rich_message);
}

export function shortGuestMessage(message,guestRequestId) {
  const event=shortMessage(message,'guest_message');
  for(const key of ['messageId','replyTo','topicId','topicUnknown','albumId'])delete event[key];
  return {...event,guestRequestId,chatType:message.chat.type,...(message.chat.title?{chatTitle:message.chat.title}:{})};
}

export function createGuestEvents({store,getBot,resolveActor,enqueue,isKnownMember=()=>false}) {
  function isCurrent(scope,id) {
    try {
      const req=store.get(scope,id),actor=resolveActor(scope.botId,req.callerUserId);
      return Boolean(actor&&actor.agentId===scope.agentId&&!isKnownMember(scope.botId,req.message.chat));
    }catch{return false;}
  }
  return {isCurrent,
    receive(botId,update) {
      const message=update.guest_message;
      if(!message)return false;
      if(botId==='master'||!Number.isSafeInteger(message.from?.id)||message.from.id<=0||message.sender_chat||typeof message.guest_query_id!=='string'||!message.guest_query_id||!['private','group','supergroup'].includes(message.chat?.type)||!explicitGuestMention(message,getBot(botId))||isKnownMember(botId,message.chat))return true;
      const scope=resolveActor(botId,message.from.id);if(!scope)return true;
      const {request,created}=store.record({botId,agentId:scope.agentId,callerUserId:message.from.id,updateId:update.update_id,message});
      if(created)enqueue(scope,shortGuestMessage(message,request.guestRequestId),()=>isCurrent(scope,request.guestRequestId));
      return true;
    },
  };
}
