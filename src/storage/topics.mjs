import {topicIdOf} from '../telegram/topics.mjs';
export function createTopicStore(db) {
 const sql=db.sql;
 const ensure=(botId,chatId,topicId)=>sql.prepare('INSERT OR IGNORE INTO topics(botId,chatId,topicId) VALUES(?,?,?)').run(botId,chatId,topicId);
 const field=(botId,chatId,topicId,key,value,date,embedded)=>{
  sql.prepare(`UPDATE topics SET ${key}=?,${key}At=? WHERE botId=? AND chatId=? AND topicId=? AND (${key}At IS NULL OR ${key}At${embedded?'<':'<='}?)`).run(value,date,botId,chatId,topicId,date);
 };
 const observe=(botId,message,embedded=false)=>{
  const topicId=topicIdOf(message);if(topicId===null)return;
  const chatId=message.chat.id,date=message.edit_date??message.date??0;
  ensure(botId,chatId,1);ensure(botId,chatId,topicId);
  const set=(key,value)=>field(botId,chatId,topicId,key,value,date,embedded);
  if(message.forum_topic_created?.name!==undefined)set('name',message.forum_topic_created.name);
  if(message.forum_topic_edited?.name!==undefined)set('name',message.forum_topic_edited.name);
  if(message.forum_topic_created||message.forum_topic_reopened)set('closed',0);
  if(message.forum_topic_closed)set('closed',1);
  if(topicId===1){
   if(message.general_forum_topic_hidden){set('hidden',1);set('closed',1);}
   if(message.general_forum_topic_unhidden||message.forum_topic_reopened)set('hidden',0);
  }
 };
 return {
  observeMessage(botId,message){observe(botId,message);const embedded=message.reply_to_message;if(embedded?.chat?.id===message.chat?.id)observe(botId,embedded,true);},
  list(botId,chatId){
   const chat=db.getChat(botId,chatId),enabled=!!(chat&&JSON.parse(chat.json).is_forum);
   if(enabled)ensure(botId,chatId,1);
   return {enabled,topics:sql.prepare('SELECT * FROM topics WHERE botId=? AND chatId=? ORDER BY topicId').all(botId,chatId).map(r=>({topicId:r.topicId,name:r.name??(r.topicId===1?'General':null),...(r.closed===null?{}:{closed:!!r.closed}),...(r.topicId!==1||r.hidden===null?{}:{hidden:!!r.hidden})}))};
  }
 };
}
