// Profile file IDs are obtained through the child token, including the master's avatar.
export function createInlineAvatars({telegram,getBot,getMasterId=()=>undefined,now=Date.now,ttlMs=300000,timeoutMs=1500}){
  const cache=new Map();let closed=false;
  const validId=id=>Number.isSafeInteger(id)&&id>0;
  function forget(botId){const record=cache.get(botId);cache.delete(botId);record?.abort.abort();}
  function get(botId){
    if(closed)return Promise.resolve(null);
    const bot=getBot(botId);if(!validId(bot?.telegramId))return Promise.resolve(null);
    const previous=cache.get(botId);
    if(previous?.telegramId===bot.telegramId&&(previous.pending||previous.until>now()))return previous.promise;
    forget(botId);
    const record={telegramId:bot.telegramId,abort:new AbortController(),pending:true,until:Infinity};
    async function profile(userId){
      if(closed||record.abort.signal.aborted||!validId(userId))return null;
      try{
        const result=await telegram.call(botId,'getUserProfilePhotos',{user_id:userId,limit:1},{signal:AbortSignal.any([record.abort.signal,AbortSignal.timeout(timeoutMs)])});
        if(closed||record.abort.signal.aborted)return null;
        // getChat().photo is a ChatPhoto and cannot be used as a cached inline Photo.
        const sizes=result?.photos?.[0];
        return Array.isArray(sizes)?sizes.findLast(p=>typeof p?.file_id==='string'&&p.file_id)?.file_id??null:null;
      }catch{return null;}
    }
    record.promise=(async()=>{
      const own=await profile(bot.telegramId);if(own)return own;
      const masterId=getMasterId();return masterId!==bot.telegramId?profile(masterId):null;
    })().finally(()=>{record.pending=false;record.until=now()+ttlMs;});
    cache.set(botId,record);return record.promise;
  }
  return {get,forget,close(){closed=true;for(const botId of cache.keys())forget(botId);}};
}
