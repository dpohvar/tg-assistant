CREATE TABLE widget_instances_15 (
 widgetId TEXT PRIMARY KEY,botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('active','stopped')),handler TEXT NOT NULL,snapshotId TEXT NOT NULL,
 description TEXT NOT NULL,state TEXT NOT NULL,createdAt INTEGER NOT NULL,stoppedReason TEXT,
 lifecycleIntent TEXT,sequence INTEGER NOT NULL DEFAULT 0,dropped INTEGER NOT NULL DEFAULT 0,lastError TEXT
);
INSERT INTO widget_instances_15(widgetId,botId,agentId,generation,status,handler,snapshotId,description,state,createdAt,stoppedReason,lifecycleIntent,sequence,dropped)
 SELECT widgetId,botId,agentId,generation,CASE status WHEN 'disabled' THEN 'stopped' ELSE status END,
 handler,snapshotId,description,state,createdAt,disabledReason,lifecycleIntent,sequence,dropped FROM widgets;

CREATE TABLE widget_views (
 viewId TEXT PRIMARY KEY,widgetId TEXT NOT NULL REFERENCES widget_instances_15 ON DELETE CASCADE,
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 chatId INTEGER,messageId INTEGER,inlineMessageId TEXT,chatType TEXT,topicId INTEGER,
 props TEXT NOT NULL DEFAULT '{}',bindingEpoch TEXT NOT NULL,message TEXT,renderHash TEXT,renderSpec TEXT,
 buttonNames TEXT NOT NULL DEFAULT '[]',pollId TEXT,lastError TEXT,deliveryUnknown INTEGER NOT NULL DEFAULT 0,
 CHECK((inlineMessageId IS NOT NULL AND chatId IS NULL AND messageId IS NULL) OR
       (inlineMessageId IS NULL AND chatId IS NOT NULL AND messageId IS NOT NULL))
);
CREATE UNIQUE INDEX widget_view_message ON widget_views(botId,chatId,messageId) WHERE inlineMessageId IS NULL;
CREATE UNIQUE INDEX widget_view_inline ON widget_views(botId,inlineMessageId) WHERE inlineMessageId IS NOT NULL;
CREATE INDEX widget_view_widget ON widget_views(widgetId);
CREATE INDEX widget_view_poll ON widget_views(botId,pollId) WHERE pollId IS NOT NULL;
INSERT INTO widget_views(viewId,widgetId,botId,agentId,chatId,messageId,chatType,topicId,bindingEpoch,message,renderHash,renderSpec,buttonNames,pollId)
 SELECT 'v'||lower(hex(randomblob(16))),w.widgetId,w.botId,w.agentId,w.chatId,w.messageId,c.chatType,w.topicId,
 lower(hex(randomblob(16))),w.message,w.renderHash,w.renderSpec,w.buttonNames,w.pollId
 FROM widgets w LEFT JOIN chats c ON c.botId=w.botId AND c.chatId=w.chatId WHERE w.messageId IS NOT NULL;

CREATE TABLE widget_publication_candidates (
 viewId TEXT PRIMARY KEY,widgetId TEXT NOT NULL REFERENCES widget_instances_15 ON DELETE CASCADE,
 botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 chatId INTEGER NOT NULL,messageId INTEGER,createdAt INTEGER NOT NULL,reason TEXT NOT NULL
);
INSERT INTO widget_publication_candidates(viewId,widgetId,botId,agentId,chatId,createdAt,reason)
 SELECT 'v'||lower(hex(randomblob(16))),widgetId,botId,agentId,chatId,createdAt,'delivery_unknown'
 FROM widgets WHERE messageId IS NULL;

CREATE TABLE widget_events_15 (
 widgetId TEXT NOT NULL REFERENCES widget_instances_15 ON DELETE CASCADE,seq INTEGER NOT NULL,
 payload TEXT NOT NULL,bytes INTEGER NOT NULL,started INTEGER NOT NULL DEFAULT 0,
 durable INTEGER NOT NULL DEFAULT 1,admission TEXT,PRIMARY KEY(widgetId,seq)
);
INSERT INTO widget_events_15(widgetId,seq,payload,bytes,started,durable)
 SELECT e.widgetId,e.seq,e.payload,e.bytes,e.started,e.durable FROM widget_events e
 JOIN widgets w ON w.widgetId=e.widgetId WHERE w.status='active';
CREATE TABLE widget_control_jobs_15 (
 widgetId TEXT NOT NULL,seq INTEGER NOT NULL,state TEXT,PRIMARY KEY(widgetId,seq),
 FOREIGN KEY(widgetId,seq) REFERENCES widget_events_15 ON DELETE CASCADE
);
INSERT INTO widget_control_jobs_15 SELECT c.* FROM widget_control_jobs c
 JOIN widget_events_15 e ON e.widgetId=c.widgetId AND e.seq=c.seq;
CREATE TABLE widget_poll_answers_15 (
 widgetId TEXT NOT NULL REFERENCES widget_instances_15 ON DELETE CASCADE,pollId TEXT NOT NULL,
 voter TEXT NOT NULL,json TEXT NOT NULL,receivedAt INTEGER NOT NULL,PRIMARY KEY(widgetId,pollId,voter)
);
INSERT INTO widget_poll_answers_15
 SELECT p.widgetId,w.pollId,p.voter,p.json,p.receivedAt FROM widget_poll_answers p
 JOIN widgets w ON w.widgetId=p.widgetId WHERE w.pollId IS NOT NULL;

DROP TABLE widget_control_jobs;
DROP TABLE widget_events;
DROP TABLE widget_poll_answers;
DROP TABLE widgets;
ALTER TABLE widget_instances_15 RENAME TO widgets;
ALTER TABLE widget_events_15 RENAME TO widget_events;
ALTER TABLE widget_control_jobs_15 RENAME TO widget_control_jobs;
ALTER TABLE widget_poll_answers_15 RENAME TO widget_poll_answers;
CREATE INDEX widgets_owner ON widgets(botId,agentId,status);
INSERT INTO schema_migrations VALUES(15);
