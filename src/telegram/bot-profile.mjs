export async function activeBotUsernames({db,telegram,botId}) {
  const bot=db.getBot(botId);
  if(!bot)return new Set();
  const chat=await telegram.call(botId,'getChat',{chat_id:bot.telegramId},{signal:AbortSignal.timeout(3000)});
  if(chat?.id!==bot.telegramId)return new Set();
  const active=[chat.username,...(Array.isArray(chat.active_usernames)?chat.active_usernames:[])];
  return new Set(active.filter(name=>typeof name==='string').map(name=>name.toLowerCase()));
}

export function createBotAddressMatcher({db,telegram,botId}) {
  let names;
  return async username => {
    if(!username)return true;
    names??=activeBotUsernames({db,telegram,botId});
    return (await names).has(username.toLowerCase());
  };
}
