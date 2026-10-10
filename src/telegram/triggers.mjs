export function normalizeTriggers(values) {
  if (values.length > 200) throw Object.assign(new Error('Допускается не более 200 триггеров.'), { safe: true });
  const seen = new Set(), result = [];
  for (const value of values) {
    if ([...value].length < 2 || [...value].length > 50 || /[\r\n]/u.test(value)) throw Object.assign(new Error('Триггер должен содержать 2–50 символов без переносов строк.'), { safe: true });
    const key = value.toLowerCase(); if (!seen.has(key)) { seen.add(key); result.push(value); }
  }
  return result;
}
export function matchesTrigger(text, triggers) {
  return triggers.some(value => new RegExp('(?<!\\p{L})' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\p{L})', 'iu').test(text));
}
export function messageTriggers(message, bot, configured) {
  if(message.chat.type==='private')return [];
  const text=message.text??message.caption??'',result=[],seen=new Set();
  const add=value=>{const key=value.toLowerCase();if(!seen.has(key)){seen.add(key);result.push(value);}};
  for(const entity of message.entities??message.caption_entities??[]){
    if(entity.type!=='mention')continue;const value=text.slice(entity.offset,entity.offset+entity.length);
    if(value.toLowerCase()==='@'+bot.username.toLowerCase())add('mention:'+value);
  }
  if(message.reply_to_message?.from?.id===bot.telegramId)add('reply');
  if(!message.is_automatic_forward)for(const value of configured)if(matchesTrigger(text,[value]))add('match:'+value);
  return result;
}
