CREATE TABLE usage_bots(telegramId INTEGER PRIMARY KEY, username TEXT NOT NULL, startedAt INTEGER NOT NULL);
CREATE TABLE usage_buckets(telegramId INTEGER NOT NULL REFERENCES usage_bots ON DELETE CASCADE,kind TEXT NOT NULL,slot TEXT NOT NULL,counters TEXT NOT NULL,PRIMARY KEY(telegramId,kind,slot));
CREATE TABLE usage_threads(threadId TEXT PRIMARY KEY,telegramId INTEGER NOT NULL REFERENCES usage_bots,agentId TEXT NOT NULL,rootThreadId TEXT NOT NULL,counters TEXT,seed INTEGER NOT NULL DEFAULT 0,seenAt INTEGER NOT NULL,finishedAt INTEGER,turnId TEXT);
CREATE INDEX usage_threads_root ON usage_threads(rootThreadId);
CREATE TABLE usage_images(threadId TEXT NOT NULL REFERENCES usage_threads ON DELETE CASCADE,itemId TEXT NOT NULL,started INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,seenAt INTEGER NOT NULL,PRIMARY KEY(threadId,itemId));
INSERT INTO usage_bots SELECT telegramId,username,CAST(strftime('%s','now') AS INTEGER)*1000 FROM bots;
INSERT INTO controller_state VALUES('usage_started_at',CAST(strftime('%s','now') AS INTEGER)*1000);
INSERT INTO schema_migrations VALUES(12);
