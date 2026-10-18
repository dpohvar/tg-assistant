CREATE TABLE inline_buttons (
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,btnId TEXT NOT NULL,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,tipId TEXT NOT NULL,
 key TEXT NOT NULL,btnGroup TEXT,callbackKey TEXT NOT NULL,permits TEXT,action TEXT NOT NULL,
 component TEXT NOT NULL DEFAULT 'keyboard',createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,PRIMARY KEY(botId,btnId)
);
CREATE INDEX inline_buttons_tip ON inline_buttons(botId,tipId,btnGroup);
CREATE TABLE inline_closed_groups (
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,tipId TEXT NOT NULL,btnGroup TEXT NOT NULL,
 expiresAt INTEGER NOT NULL,PRIMARY KEY(botId,tipId,btnGroup)
);
CREATE TABLE inline_message_owners (
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,inlineMessageId TEXT NOT NULL,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,
 PRIMARY KEY(botId,inlineMessageId)
);
CREATE TABLE inline_snapshots (
 botId TEXT NOT NULL,inlineMessageId TEXT NOT NULL,content TEXT NOT NULL DEFAULT '{}',
 updatedAt INTEGER,expiresAt INTEGER NOT NULL,deliveryUnknown INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(botId,inlineMessageId),FOREIGN KEY(botId,inlineMessageId) REFERENCES inline_message_owners ON DELETE CASCADE
);
CREATE TABLE inline_button_events (
 eventId TEXT PRIMARY KEY,botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,callbackId TEXT NOT NULL,payload TEXT NOT NULL,
 component TEXT NOT NULL DEFAULT 'keyboard',createdAt INTEGER NOT NULL,queuedAt INTEGER,discardedAt INTEGER,UNIQUE(botId,callbackId)
);
CREATE INDEX inline_events_pending ON inline_button_events(queuedAt,createdAt);
INSERT INTO schema_migrations VALUES(16);
