ALTER TABLE messages ADD COLUMN receiptSeq INTEGER;
UPDATE messages SET receiptSeq=rowid;
CREATE TABLE message_sequence(value INTEGER NOT NULL);
INSERT INTO message_sequence SELECT COALESCE(MAX(receiptSeq),0) FROM messages;
INSERT INTO schema_migrations VALUES(6);
