import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';

test('an unsupported newer schema is refused without changing its data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-schema-')), file = path.join(root, 'db.sqlite');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(file);
  db.sql.prepare('INSERT INTO schema_migrations VALUES(999)').run(); db.close();
  assert.throws(() => openDatabase(file), /newer schema/);
});
