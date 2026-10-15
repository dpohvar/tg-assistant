CREATE TABLE sticker_sets (
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 name TEXT NOT NULL COLLATE NOCASE,
 title TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('regular','custom_emoji')),
 ownerUserId INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('uncertain','confirmed')),
 PRIMARY KEY(botId,name)
);
INSERT INTO schema_migrations VALUES(14);
