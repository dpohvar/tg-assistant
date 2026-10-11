ALTER TABLE messages ADD COLUMN topicId INTEGER;
UPDATE messages SET topicId=CASE WHEN json_extract(json,'$.message_thread_id') > 0 THEN json_extract(json,'$.message_thread_id') ELSE 1 END WHERE json_extract(json,'$.chat.is_forum')=1;
CREATE INDEX messages_topic ON messages(botId,chatId,topicId,date,messageId);
CREATE TABLE topics (
 botId TEXT NOT NULL, chatId INTEGER NOT NULL, topicId INTEGER NOT NULL,
 name TEXT, closed INTEGER, hidden INTEGER,
 nameAt INTEGER, closedAt INTEGER, hiddenAt INTEGER,
 PRIMARY KEY(botId,chatId,topicId),
 FOREIGN KEY(botId,chatId) REFERENCES chats(botId,chatId) ON DELETE CASCADE
);
INSERT INTO schema_migrations VALUES(11);
