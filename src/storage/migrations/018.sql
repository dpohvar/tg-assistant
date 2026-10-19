CREATE TABLE ephemeral_messages (
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 chatId INTEGER NOT NULL,ephemeralMessageId INTEGER NOT NULL,receiverUserId INTEGER NOT NULL,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
 message TEXT NOT NULL,signature TEXT NOT NULL,
 createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,
 deleted INTEGER NOT NULL DEFAULT 0,collided INTEGER NOT NULL DEFAULT 0,
 deliveryUnknown INTEGER NOT NULL DEFAULT 0,queued INTEGER NOT NULL DEFAULT 0,eventState TEXT,
 PRIMARY KEY(botId,chatId,ephemeralMessageId,receiverUserId)
);
CREATE INDEX ephemeral_expiry ON ephemeral_messages(expiresAt);
INSERT INTO schema_migrations VALUES(18);
