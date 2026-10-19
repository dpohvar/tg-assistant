CREATE TABLE widget_publication_candidates_17 (
 viewId TEXT PRIMARY KEY,widgetId TEXT NOT NULL REFERENCES widgets ON DELETE CASCADE,
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 chatId INTEGER,messageId INTEGER,createdAt INTEGER NOT NULL,reason TEXT NOT NULL,
 inlineMessageId TEXT,guestRequestId TEXT,
 CHECK((chatId IS NOT NULL AND inlineMessageId IS NULL AND guestRequestId IS NULL) OR
       (chatId IS NULL AND messageId IS NULL AND inlineMessageId IS NOT NULL AND guestRequestId IS NULL) OR
       (chatId IS NULL AND messageId IS NULL AND inlineMessageId IS NULL AND guestRequestId IS NOT NULL))
);
INSERT INTO widget_publication_candidates_17(viewId,widgetId,botId,agentId,chatId,messageId,createdAt,reason)
 SELECT viewId,widgetId,botId,agentId,chatId,messageId,createdAt,reason FROM widget_publication_candidates;
DROP TABLE widget_publication_candidates;
ALTER TABLE widget_publication_candidates_17 RENAME TO widget_publication_candidates;

CREATE TABLE guest_requests (
 guestRequestId TEXT PRIMARY KEY,
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 callerUserId INTEGER NOT NULL,queryId TEXT NOT NULL,updateId INTEGER,
 receivedAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,message TEXT NOT NULL,
 UNIQUE(botId,queryId)
);
CREATE INDEX guest_request_expiry ON guest_requests(expiresAt);
CREATE TABLE guest_publications (
 publicationId TEXT PRIMARY KEY,
 guestRequestId TEXT NOT NULL REFERENCES guest_requests ON DELETE CASCADE,
 createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,
 viewId TEXT,prepared TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','confirmed','rejected','unknown')),
 inlineMessageId TEXT,outcome TEXT
);
CREATE INDEX guest_publication_request ON guest_publications(guestRequestId,createdAt);
CREATE INDEX guest_publication_expiry ON guest_publications(expiresAt);
INSERT INTO schema_migrations VALUES(17);
