import {createHash} from 'node:crypto';
import {topicIdOf} from '../telegram/topics.mjs';
const identity=m=>createHash('sha256').update(JSON.stringify({date:m.date,from:m.from?.id,receiver:m.receiver_user?.id,text:m.text,entities:m.entities??[]})).digest('hex');
const address=(botId,m,userId)=>`${botId}:${m.chat?.id}:${topicIdOf(m)??0}:${userId}:${m.ephemeral_message_id!==undefined?'e':'m'}:${m.ephemeral_message_id??m.message_id}`;
export function createUploadInvitations({db,now=Date.now}){
  const pending=new Map();
  const cleanup=()=>{for(const [key,entry] of pending)if(now()>=entry.expiresAt)pending.delete(key);};
  return {
    register(botId,request,sent,{name,args}){
      cleanup();const bot=db.getBot(botId),id=sent?.ephemeral_message_id??sent?.message_id;
      if(!bot||!['upload','set_rules'].includes(name)||!Number.isSafeInteger(id)||id<=0||sent.from?.id!==bot.telegramId||sent.chat?.id!==request.chat.id||sent.ephemeral_message_id!==undefined&&sent.receiver_user?.id!==request.from?.id)return;
      const key=address(botId,sent,request.from.id);
      const path=args[0]?.value;
      const text=name==='upload'?`/upload ${path}`:'/rules set';
      const command={text,entities:name==='upload'?[{type:'code',offset:8,length:path.length}]:[]};
      const entry={botId,name,command,expiresAt:now()+3600000,fingerprint:identity(sent),busy:null};pending.set(key,entry);return entry;
    },
    acquire(botId,message){
      cleanup();const quoted=message.reply_to_message,bot=db.getBot(botId);
      if(!message.document||!quoted||!bot||message.sender_chat||message.edit_date!==undefined||quoted.sender_chat||quoted.edit_date!==undefined||quoted.forward_origin||quoted.from?.id!==bot.telegramId||quoted.chat?.id!==message.chat.id||topicIdOf(quoted)!==topicIdOf(message)||quoted.ephemeral_message_id!==undefined&&quoted.receiver_user?.id!==message.from?.id)return null;
      const key=address(botId,quoted,message.from?.id),entry=pending.get(key);
      if(!entry||entry.fingerprint!==identity(quoted))return null;
      if(entry.busy)return {busy:true};
      const lease=Symbol();entry.busy=lease;
      return {entry,succeed(){if(pending.get(key)===entry&&entry.busy===lease)pending.delete(key);},release(){if(pending.get(key)===entry&&entry.busy===lease)entry.busy=null;}};
    },
    clear(botId){for(const [key,entry] of pending)if(botId===undefined||entry.botId===botId)pending.delete(key);},
  };
}
