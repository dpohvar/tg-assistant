CREATE TABLE widgets (
 widgetId TEXT PRIMARY KEY,botId TEXT NOT NULL REFERENCES bots ON DELETE CASCADE,
 agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('active','disabled')),chatId INTEGER NOT NULL,messageId INTEGER,topicId INTEGER,
 handler TEXT NOT NULL,snapshotId TEXT NOT NULL,description TEXT NOT NULL,state TEXT NOT NULL,message TEXT,
 createdAt INTEGER NOT NULL,disabledReason TEXT,lifecycleIntent TEXT,renderHash TEXT,renderSpec TEXT,
 buttonNames TEXT NOT NULL DEFAULT '[]',pollId TEXT,sequence INTEGER NOT NULL DEFAULT 0,dropped INTEGER NOT NULL DEFAULT 0,
 UNIQUE(botId,chatId,messageId)
);
CREATE INDEX widgets_owner ON widgets(botId,agentId,status);
CREATE INDEX widgets_poll ON widgets(botId,pollId);
CREATE TABLE widget_events (
 widgetId TEXT NOT NULL REFERENCES widgets ON DELETE CASCADE,seq INTEGER NOT NULL,
 payload TEXT NOT NULL,bytes INTEGER NOT NULL,started INTEGER NOT NULL DEFAULT 0,
 durable INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(widgetId,seq)
);
CREATE TABLE widget_control_jobs (
 widgetId TEXT NOT NULL,seq INTEGER NOT NULL,state TEXT,
 PRIMARY KEY(widgetId,seq),FOREIGN KEY(widgetId,seq) REFERENCES widget_events ON DELETE CASCADE
);
CREATE TABLE widget_poll_answers (
 widgetId TEXT NOT NULL REFERENCES widgets ON DELETE CASCADE,voter TEXT NOT NULL,json TEXT NOT NULL,
 receivedAt INTEGER NOT NULL,PRIMARY KEY(widgetId,voter)
);
INSERT INTO schema_migrations VALUES(13);
