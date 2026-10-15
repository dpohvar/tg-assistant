import { richText } from '../telegram/short-message.mjs';
import {topicIdOf} from '../telegram/topics.mjs';
import {createTopicStore} from './topics.mjs';
import {createUsageStore} from './usage.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sql = new DatabaseSync(filename, { timeout: 5000 });
  sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  try {
    sql.exec('BEGIN IMMEDIATE');
    sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)');
    const version = sql.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
    if (version > 14) throw new Error('Database uses a newer schema than this controller supports.');
    for (let n = 1; n <= 14; n++) if (!sql.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(n)) {
      sql.exec(fs.readFileSync(new URL(`./migrations/${String(n).padStart(3, '0')}.sql`, import.meta.url), 'utf8'));
    }
    if(version<11){
      const topics=createTopicStore({sql,getChat:(botId,chatId)=>sql.prepare('SELECT * FROM chats WHERE botId=? AND chatId=?').get(botId,chatId)});
      for(const row of sql.prepare('SELECT botId,json FROM messages WHERE topicId IS NOT NULL ORDER BY date,messageId').all())topics.observeMessage(row.botId,JSON.parse(row.json));
    }
    sql.exec('COMMIT');
  } catch (error) { try { sql.exec('ROLLBACK'); } finally { sql.close(); } throw error; }
  const getBot = botId => sql.prepare('SELECT * FROM bots WHERE botId=?').get(botId) ?? null;
  const chatObservers=new Set();
  const db = {
    sql, close: () => sql.close(),
    onChatObserved(fn){chatObservers.add(fn);return ()=>chatObservers.delete(fn);},
    transaction(fn) { sql.exec('BEGIN IMMEDIATE'); try { const result = fn(); if (result?.then) throw new Error('Transactions must be synchronous'); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
    registerBot(bot) {
      sql.prepare('INSERT INTO bots(botId,telegramId,username,ownerId,defaultModel) VALUES(?,?,?,?,?)').run(bot.botId, bot.telegramId, bot.username, bot.ownerId, bot.defaultModel ?? 'gpt-6.1-sol');
      createUsageStore(db).sync();
    },
    getBot,
    role(botId, userId) { if (getBot(botId)?.ownerId === userId) return 'owner'; return sql.prepare('SELECT role FROM roles WHERE botId=? AND userId=?').get(botId, userId)?.role ?? null; },
    setRole(botId, userId, role) { sql.prepare('INSERT INTO roles VALUES(?,?,?) ON CONFLICT(botId,userId) DO UPDATE SET role=excluded.role').run(botId, userId, role); },
    saveChat(botId, chat, {observeTopics=true} = {}) {
      for(const observe of chatObservers)observe(botId,chat);
      sql.prepare('INSERT INTO chats(botId,chatId,chatType,name,json) VALUES(?,?,?,?,?) ON CONFLICT(botId,chatId) DO UPDATE SET chatType=excluded.chatType,name=excluded.name,json=excluded.json').run(botId, chat.id, chat.type, chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' '), JSON.stringify(chat));
      if(observeTopics&&chat.is_forum)sql.prepare('INSERT OR IGNORE INTO topics(botId,chatId,topicId) VALUES(?,?,1)').run(botId,chat.id);
    },
    getChat(botId, chatId) { return sql.prepare('SELECT * FROM chats WHERE botId=? AND chatId=?').get(botId, chatId) ?? null; },
    agent(botId, chatId) { return sql.prepare('SELECT * FROM agents WHERE botId=? AND chatId=?').get(botId, chatId) ?? null; },
    ensureAgent(botId, chatId) {
      const existing = this.agent(botId, chatId); if (existing) return existing;
      sql.prepare('UPDATE chats SET agentEnabled=1 WHERE botId=? AND chatId=?').run(botId,chatId);
      const bot = getBot(botId); if (!bot) throw new Error('Unknown bot');
      const agentId = 'a' + randomUUID().replaceAll('-', '');
      sql.prepare('INSERT INTO agents(agentId,botId,chatId,model,createdAt) VALUES(?,?,?,?,?)').run(agentId, botId, chatId, bot.defaultModel, Date.now());
      return this.agent(botId, chatId);
    },
    migrateChat(botId,oldId,chat) {
      const old=this.getChat(botId,oldId);if(!old)return;
      this.transaction(()=>{
        sql.exec('PRAGMA defer_foreign_keys=ON');
        const existing=this.getChat(botId,chat.id);
        if(existing && (this.agent(botId,chat.id)||sql.prepare('SELECT 1 FROM messages WHERE botId=? AND chatId=?').get(botId,chat.id)||sql.prepare('SELECT 1 FROM topics WHERE botId=? AND chatId=?').get(botId,chat.id)))throw new Error('Migration target already contains dialog data.');
        this.saveChat(botId,chat,{observeTopics:false});
        sql.prepare('UPDATE chats SET agentEnabled=?,triggers=? WHERE botId=? AND chatId=?').run(old.agentEnabled,old.triggers,botId,chat.id);
        for(const table of ['agents','messages','button_state','topics'])sql.prepare(`UPDATE ${table} SET chatId=? WHERE botId=? AND chatId=?`).run(chat.id,botId,oldId);
        for(const row of sql.prepare('SELECT widgetId,message FROM widgets WHERE botId=? AND chatId=?').all(botId,oldId)){
          const message=row.message?JSON.parse(row.message):null;if(message?.chat)message.chat={...message.chat,...chat};
          sql.prepare('UPDATE widgets SET chatId=?,message=? WHERE widgetId=?').run(chat.id,message?JSON.stringify(message):null,row.widgetId);
        }
        for(const row of sql.prepare('SELECT e.widgetId,e.seq,e.payload FROM widget_events e JOIN widgets w USING(widgetId) WHERE w.botId=?').all(botId)){
          const event=JSON.parse(row.payload);if(!['button','reply','reaction'].includes(event.source))continue;
          const rewrite=v=>{if(!v||typeof v!=='object')return;if(v.chat?.id===oldId)v.chat={...v.chat,...chat};for(const x of Object.values(v))rewrite(x);};rewrite(event.data);
          const payload=JSON.stringify(event);sql.prepare('UPDATE widget_events SET payload=?,bytes=?+COALESCE((SELECT length(CAST(state AS BLOB)) FROM widget_control_jobs WHERE widgetId=? AND seq=?),0) WHERE widgetId=? AND seq=?').run(payload,Buffer.byteLength(payload),row.widgetId,row.seq,row.widgetId,row.seq);
        }
        if(chat.is_forum)sql.prepare('INSERT OR IGNORE INTO topics(botId,chatId,topicId) VALUES(?,?,1)').run(botId,chat.id);
        for(const row of sql.prepare('SELECT messageId,json FROM messages WHERE botId=? AND chatId=?').all(botId,chat.id)){const m=JSON.parse(row.json);m.chat={...m.chat,...chat};sql.prepare('UPDATE messages SET json=? WHERE botId=? AND chatId=? AND messageId=?').run(JSON.stringify(m),botId,chat.id,row.messageId);}
        sql.prepare('DELETE FROM chats WHERE botId=? AND chatId=?').run(botId,oldId);
      });
    },
    saveMessage(botId, m, receivedAt = Date.now(), {observeChat=true} = {}) {
      const known = this.getChat(botId, m.chat.id); if(observeChat||!known)this.saveChat(botId, m.chat);
      if (!known && m.chat.type === 'private') sql.prepare('UPDATE chats SET agentEnabled=1 WHERE botId=? AND chatId=?').run(botId,m.chat.id);
      const existing = this.messageRecord(botId, m.chat.id, m.message_id);
      const reactions = existing ? JSON.parse(existing.json).reactions : undefined;
      if (reactions && !m.reactions) m = { ...m, reactions };
      const sequence = existing?.receiptSeq ?? sql.prepare('UPDATE message_sequence SET value=value+1 RETURNING value').get().value;
      sql.prepare(`INSERT INTO messages(botId,chatId,messageId,receivedAt,date,editDate,senderId,replyTo,plainText,json,receiptSeq,topicId) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(botId,chatId,messageId) DO UPDATE SET date=excluded.date,editDate=excluded.editDate,senderId=excluded.senderId,replyTo=excluded.replyTo,plainText=excluded.plainText,json=excluded.json,topicId=COALESCE(excluded.topicId,messages.topicId)`)
        .run(botId, m.chat.id, m.message_id, receivedAt, m.date, m.edit_date ?? null, m.sender_chat?.id ?? m.from?.id ?? null, m.reply_to_message?.message_id ?? null, m.text ?? m.caption ?? richText(m.rich_message), JSON.stringify(m), sequence,topicIdOf(m));
      createTopicStore(this).observeMessage(botId,m);
    },
    messageRecord(botId, chatId, messageId) { return sql.prepare('SELECT * FROM messages WHERE botId=? AND chatId=? AND messageId=?').get(botId, chatId, messageId) ?? null; },
    getMessage(botId, chatId, messageId) { const row = this.messageRecord(botId, chatId, messageId); return row ? JSON.parse(row.json) : null; },
    setOffset(botId, offset) { sql.prepare('INSERT INTO polling_offsets VALUES(?,?) ON CONFLICT(botId) DO UPDATE SET offset=excluded.offset').run(botId, offset); },
    getOffset(botId) { return sql.prepare('SELECT offset FROM polling_offsets WHERE botId=?').get(botId)?.offset ?? 0; },
  };
  return db;
}
