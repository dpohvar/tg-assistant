-- The React engine does not execute legacy widget code or replay its event queue.
-- Capture only confirmed, owned publications before removing legacy registrations.
CREATE TABLE widget_legacy_cleanup (
 jobId TEXT PRIMARY KEY, botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 target TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','done','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT, createdAt INTEGER NOT NULL
);
INSERT INTO widget_legacy_cleanup(jobId,botId,agentId,target,createdAt)
 SELECT viewId,botId,agentId,
   CASE WHEN inlineMessageId IS NOT NULL
     THEN json_object('inlineMessageId',inlineMessageId)
     ELSE json_object('chatId',chatId,'messageId',messageId) END,
   CAST(strftime('%s','now') AS INTEGER)*1000
 FROM widget_views
 WHERE message IS NOT NULL AND deliveryUnknown=0 AND
   (inlineMessageId IS NOT NULL OR (chatId IS NOT NULL AND messageId IS NOT NULL));

DROP TABLE widget_control_jobs;
DROP TABLE widget_events;
DROP TABLE widget_poll_answers;
DROP TABLE widget_publication_candidates;
DROP TABLE widget_views;
DROP TABLE widgets;

CREATE TABLE widgets (
 widgetId TEXT PRIMARY KEY, botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','error')),
 handler TEXT NOT NULL, buildId TEXT, description TEXT NOT NULL,
 runtimeProps TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT '{}',
 storeVersion INTEGER NOT NULL DEFAULT 0, storeRevision INTEGER NOT NULL DEFAULT 0,
 createdAt INTEGER NOT NULL, lastError TEXT, lifecycleIntent TEXT,
 CHECK(json_valid(runtimeProps) AND json_valid(state))
);
CREATE INDEX widgets_owner ON widgets(botId,agentId,status);
CREATE TABLE widget_views (
 viewId TEXT PRIMARY KEY, widgetId TEXT NOT NULL REFERENCES widgets ON DELETE CASCADE,
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 parentViewId TEXT REFERENCES widget_views ON DELETE CASCADE,
 receiverUserId INTEGER, targetKind TEXT NOT NULL
   CHECK(targetKind IN ('message','inline','ephemeral')),
 chatId INTEGER, messageId INTEGER, inlineMessageId TEXT, ephemeralMessageId INTEGER,
 chatType TEXT, topicId INTEGER, exportName TEXT,
 props TEXT, rendererKey TEXT, status TEXT NOT NULL DEFAULT 'active'
   CHECK(status IN ('active','error')),
 lastError TEXT, message TEXT, projection TEXT, projectionHash TEXT,
 bindingEpoch TEXT NOT NULL, deliveryUnknown INTEGER NOT NULL DEFAULT 0,
 createdAt INTEGER NOT NULL, activeAt INTEGER NOT NULL,
 CHECK((targetKind='message' AND chatId IS NOT NULL AND messageId IS NOT NULL AND
        inlineMessageId IS NULL AND ephemeralMessageId IS NULL AND receiverUserId IS NULL) OR
       (targetKind='inline' AND inlineMessageId IS NOT NULL AND chatId IS NULL AND
        messageId IS NULL AND receiverUserId IS NULL) OR
       (targetKind='ephemeral' AND chatId IS NOT NULL AND receiverUserId IS NOT NULL AND
        ephemeralMessageId IS NOT NULL AND inlineMessageId IS NULL)),
 CHECK((receiverUserId IS NOT NULL AND parentViewId IS NOT NULL) OR
       (parentViewId IS NULL))
);
CREATE UNIQUE INDEX widget_view_message ON widget_views(botId,chatId,messageId)
 WHERE targetKind='message';
CREATE UNIQUE INDEX widget_view_inline ON widget_views(botId,inlineMessageId)
 WHERE targetKind='inline';
CREATE UNIQUE INDEX widget_view_ephemeral ON widget_views(botId,chatId,receiverUserId,ephemeralMessageId)
 WHERE targetKind='ephemeral';
CREATE INDEX widget_view_widget ON widget_views(widgetId);
CREATE INDEX widget_view_parent ON widget_views(parentViewId);
CREATE INDEX widget_view_expiry ON widget_views(activeAt) WHERE targetKind='ephemeral';

CREATE TABLE widget_publication_candidates (
 viewId TEXT PRIMARY KEY, widgetId TEXT NOT NULL REFERENCES widgets ON DELETE CASCADE,
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 target TEXT NOT NULL, createdAt INTEGER NOT NULL, reason TEXT NOT NULL,
 CHECK(json_valid(target))
);
INSERT INTO schema_migrations VALUES(21);
