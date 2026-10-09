ALTER TABLE chats ADD COLUMN agentEnabled INTEGER NOT NULL DEFAULT 0 CHECK(agentEnabled IN (0,1));
UPDATE chats SET agentEnabled=1 WHERE EXISTS(SELECT 1 FROM agents WHERE agents.botId=chats.botId AND agents.chatId=chats.chatId);
ALTER TABLE agents ADD COLUMN stopPending INTEGER NOT NULL DEFAULT 0 CHECK(stopPending IN (0,1));
ALTER TABLE task_firings ADD COLUMN missedReason TEXT;
INSERT INTO schema_migrations VALUES(8);
