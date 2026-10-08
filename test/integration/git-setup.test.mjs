import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/storage/database.mjs';
import { gitSetup } from '../../src/git/setup.mjs';

test('git setup validates clone before replacement, preserves temp and resumes after failure', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-setup-')), db = openDatabase(path.join(root, 'db.sqlite'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.registerBot({ botId: 'b', telegramId: 42, username: 'bot', ownerId: 1 });
  const config = { dataDir: path.join(root, 'control'), botsDir: path.join(root, 'bots') }, wiki = path.join(config.botsDir, 'b');
  fs.mkdirSync(path.join(wiki, '.temp'), { recursive: true }); fs.writeFileSync(path.join(wiki, '.temp', 'keep'), 'temp'); fs.writeFileSync(path.join(wiki, 'old.md'), 'old');
  let paused = 0, resumed = 0;
  const pauseBot = async () => { paused++; return () => { resumed++; }; };
  await assert.rejects(gitSetup({ db, config, pauseBot, runGit: async () => { throw new Error('Clone failed'); } }, 'b', 'main https://example.invalid/repo', null), /clone failed/i);
  assert.equal(paused, 0); assert.equal(fs.readFileSync(path.join(wiki, 'old.md'), 'utf8'), 'old');
  const runGit = async stage => { fs.mkdirSync(path.join(stage, 'repo')); fs.writeFileSync(path.join(stage, 'repo', 'new.md'), 'new'); };
  const result = await gitSetup({ db, config, pauseBot, runGit }, 'b', 'main https://example.invalid/repo', null);
  assert.equal(result.status, 'synced'); assert.equal(paused, 1); assert.equal(resumed, 1);
  assert.equal(fs.existsSync(path.join(wiki, 'old.md')), false);
  assert.equal(fs.readFileSync(path.join(wiki, 'new.md'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(wiki, '.temp', 'keep'), 'utf8'), 'temp');
  // A forbidden remote .temp is rejected before pausing or removing local files.
  await assert.rejects(gitSetup({ db, config, pauseBot, runGit: async stage => { await runGit(stage); fs.mkdirSync(path.join(stage, 'repo', '.temp')); } }, 'b', 'main https://example.invalid/repo', null), /must not contain/);
  assert.equal(paused, 1); assert.equal(resumed, 1);
  const failingDb = { ...db, sql: { prepare: query => { if (query.startsWith('INSERT INTO git_settings')) throw new Error('Storage failed'); return db.sql.prepare(query); } } };
  await assert.rejects(gitSetup({ db: failingDb, config, pauseBot, runGit }, 'b', 'main https://example.invalid/repo', null), /Storage failed/);
  assert.equal(paused, 2); assert.equal(resumed, 2);
});

test('git setup reports clone failure safely without exposing credentials', async () => {
  const { gitSetupError } = await import('../../src/git/setup.mjs');
  const secret = 'github_pat_PRIVATE';
  for (const [stderr, expected] of [
    [`fatal: Authentication failed ${secret}`, 'authorization'],
    [`fatal: Remote branch main not found ${secret}`, 'branch'],
    [`fatal: Could not resolve host ${secret}`, 'connection'],
    [`unexpected failure ${secret}`, 'clone'],
  ]) {
    const error = gitSetupError({ stderr });
    assert.equal(error.safe, true);
    assert.match(error.message, new RegExp(expected, 'i'));
    assert.ok(!error.message.includes(secret));
  }
});
