CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS bots (
  botId TEXT PRIMARY KEY, telegramId INTEGER UNIQUE NOT NULL, username TEXT NOT NULL,
  ownerId INTEGER NOT NULL, rulesVersion INTEGER NOT NULL DEFAULT 1,
  defaultModel TEXT NOT NULL DEFAULT 'gpt-6.1-sol', secretRef TEXT
);
CREATE TABLE IF NOT EXISTS roles (
  botId TEXT REFERENCES bots ON DELETE CASCADE, userId INTEGER,
  role TEXT CHECK(role IN ('user','manager','admin')), PRIMARY KEY(botId,userId)
);
CREATE TABLE IF NOT EXISTS chats (
  botId TEXT REFERENCES bots ON DELETE CASCADE, chatId INTEGER, chatType TEXT NOT NULL,
  name TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(botId,chatId)
);
CREATE TABLE IF NOT EXISTS agents (
  agentId TEXT PRIMARY KEY, botId TEXT NOT NULL, chatId INTEGER NOT NULL,
  model TEXT NOT NULL, threadId TEXT, threadRulesVersion INTEGER,
  notes TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL,
  UNIQUE(botId,chatId), FOREIGN KEY(botId,chatId) REFERENCES chats ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
  botId TEXT NOT NULL, chatId INTEGER NOT NULL, messageId INTEGER NOT NULL,
  receivedAt INTEGER NOT NULL, date INTEGER NOT NULL, editDate INTEGER,
  senderId INTEGER, replyTo INTEGER, plainText TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY(botId,chatId,messageId), FOREIGN KEY(botId,chatId) REFERENCES chats ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS messages_time ON messages(botId,chatId,date,messageId);
CREATE INDEX IF NOT EXISTS messages_receipt ON messages(receivedAt);
CREATE INDEX IF NOT EXISTS messages_reply ON messages(botId,chatId,replyTo);
CREATE TABLE IF NOT EXISTS polling_offsets(botId TEXT PRIMARY KEY REFERENCES bots ON DELETE CASCADE, offset INTEGER NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES(1);
