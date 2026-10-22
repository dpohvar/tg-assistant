CREATE TABLE button_rollbacks (
 eventId TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 botId TEXT NOT NULL, chatId INTEGER NOT NULL, messageId INTEGER NOT NULL,
 state TEXT NOT NULL, data TEXT NOT NULL, updatedAt INTEGER NOT NULL,
 FOREIGN KEY(botId,chatId,messageId) REFERENCES messages(botId,chatId,messageId) ON DELETE CASCADE
);
INSERT INTO schema_migrations VALUES(20);
