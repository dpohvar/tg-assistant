CREATE TABLE agent_control (
 agentId TEXT PRIMARY KEY REFERENCES agents ON DELETE CASCADE,
 epoch INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'running',
 wake INTEGER NOT NULL DEFAULT 0, notice TEXT, updatedAt INTEGER NOT NULL
);
CREATE TABLE agent_compactions (
 operationId TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 epoch INTEGER NOT NULL, phase TEXT NOT NULL, continuationPhase TEXT NOT NULL,
 data TEXT NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX agent_compact_active ON agent_compactions(agentId)
 WHERE phase IN ('queued','submitting','running','unknown');
CREATE TABLE agent_work (
 workId TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 state TEXT NOT NULL, data TEXT NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE agent_control_replies (
 replyId TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents ON DELETE CASCADE,
 phase TEXT NOT NULL, data TEXT NOT NULL, updatedAt INTEGER NOT NULL
);
INSERT INTO schema_migrations VALUES(19);
