import {createHash} from 'node:crypto';
export const EPHEMERAL_TTL=30*86400000;
export const ephemeralError=(code,message)=>Object.assign(new Error(message??code),{code});
const unavailable=()=>ephemeralError('ephemeral_message_unavailable','This private message is unavailable to this agent, deleted, expired or has a reused address.');
const digest=m=>createHash('sha256').update(JSON.stringify(m)).digest('hex');
const parse=row=>({...row,message:JSON.parse(row.message),eventState:row.eventState?JSON.parse(row.eventState):null,deliveryUnknown:!!row.deliveryUnknown});
export function createEphemeralStore(db,{now=Date.now}={}){
  const sql=db.sql;
  const keys=(scope,address)=>[scope.botId,scope.chatId,address.ephemeralMessageId,address.receiverUserId??db.getBot(scope.botId)?.telegramId];
  const find=(scope,address)=>sql.prepare('SELECT * FROM ephemeral_messages WHERE botId=? AND chatId=? AND ephemeralMessageId=? AND receiverUserId=?').get(...keys(scope,address));
  function get(scope,address){
    if(!db.getBot(scope.botId)||!Number.isSafeInteger(address.ephemeralMessageId)||address.ephemeralMessageId<=0||address.chatId!==undefined&&address.chatId!==scope.chatId)throw unavailable();
    const row=find(scope,address);
    if(!row||row.agentId!==scope.agentId||row.deleted||row.collided||row.expiresAt<=now())throw unavailable();return parse(row);
  }
  function modify(scope,address,fields){
    get(scope,address);
    for(const [key,value] of Object.entries(fields)){
      if(!['message','deliveryUnknown','deleted','queued','eventState'].includes(key))throw ephemeralError('invalid_argument');
      sql.prepare(`UPDATE ephemeral_messages SET ${key}=? WHERE botId=? AND chatId=? AND ephemeralMessageId=? AND receiverUserId=?`).run(value,...keys(scope,address));
    }
  }
  return {
    get,
    record(scope,message,{direction,signature=digest(message)}={}){
      const bot=db.getBot(scope.botId),id=message?.ephemeral_message_id,receiver=message?.receiver_user?.id;
      if(!bot||message.chat?.id!==scope.chatId||!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(receiver)||receiver<=0||!['incoming','outgoing'].includes(direction)||direction==='incoming'&&(receiver!==bot.telegramId||message.from?.is_bot)||direction==='outgoing'&&(message.from?.id!==bot.telegramId||receiver===bot.telegramId))throw ephemeralError('invalid_argument','Invalid private message identity.');
      const address={ephemeralMessageId:id,receiverUserId:receiver};
      const result=db.transaction(()=>{
        if(!sql.prepare('SELECT 1 FROM agents WHERE agentId=? AND botId=? AND chatId=?').get(scope.agentId,scope.botId,scope.chatId))throw unavailable();
        const old=find(scope,address);
        if(old){
          if(old.signature!==signature||old.agentId!==scope.agentId||old.collided||old.deleted){sql.prepare('UPDATE ephemeral_messages SET collided=1 WHERE botId=? AND chatId=? AND ephemeralMessageId=? AND receiverUserId=?').run(...keys(scope,address));return {collision:true};}
          return {created:false,record:parse(old)};
        }
        sql.prepare('INSERT INTO ephemeral_messages(botId,chatId,ephemeralMessageId,receiverUserId,agentId,direction,message,signature,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...keys(scope,address),scope.agentId,direction,JSON.stringify(message),signature,now(),now()+EPHEMERAL_TTL);
        return {created:true,record:parse(find(scope,address))};
      });
      if(result.collision)throw ephemeralError('ephemeral_address_reused','Telegram reused this private message address; it cannot safely be read or modified.');return result;
    },
    update(scope,address,fields){const row=get(scope,address);modify(scope,address,{message:JSON.stringify({...row.message,...fields}),deliveryUnknown:0});},
    markUnknown(scope,address){modify(scope,address,{deliveryUnknown:1});},
    markDeleted(scope,address){modify(scope,address,{deleted:1});},
    setEventState(scope,address,state){modify(scope,address,{eventState:JSON.stringify(state)});},
    markQueued(scope,address){modify(scope,address,{queued:1});},
    markEvicted(scope,address){const row=get(scope,address);modify(scope,address,{queued:1,eventState:JSON.stringify({...row.eventState,evicted:true})});},
    cleanup(at=now()){sql.prepare('DELETE FROM ephemeral_messages WHERE expiresAt<=?').run(at);},
  };
}
