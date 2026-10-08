CREATE TABLE IF NOT EXISTS button_state (
 botId TEXT, chatId INTEGER, messageId INTEGER, permits TEXT, closed TEXT NOT NULL DEFAULT '[]',
 PRIMARY KEY(botId,chatId,messageId), FOREIGN KEY(botId,chatId,messageId) REFERENCES messages ON DELETE CASCADE
);
INSERT OR IGNORE INTO schema_migrations VALUES(3);
