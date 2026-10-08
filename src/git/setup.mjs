import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gitRun, gitAuth } from './operations.mjs';
export function gitSetupError(error) {
  const diagnostic = String(error.stderr ?? '');
  const message = /authentication failed|invalid username|repository not found|could not read Username/i.test(diagnostic)
    ? 'Git authorization failed. Check the token, selected repository and Contents permission.'
    : /remote branch .* not found|couldn.t find remote ref/i.test(diagnostic)
      ? 'Git branch not found. Initialize the repository and check the branch name.'
      : /could not resolve|failed to connect|certificate|timed out/i.test(diagnostic)
        ? 'Git connection failed. Check network access and HTTPS certificates.'
        : 'Git clone failed. Check the repository, branch and token. The existing wiki was not replaced.';
  return Object.assign(new Error(message), { safe: true });
}
export async function gitSetup({ db, config, pauseBot, runGit = gitRun }, botId, args, old) {
  const parts = Array.isArray(args) ? args : args.trim() ? args.trim().split(/\s+/) : [];
  if (!parts.length) return old ? { branch: old.branch, remoteUrl: old.remoteUrl, token: old.secretRef ? 'configured' : 'absent' } : { configured: false };
  if (parts.length > 3) throw new Error('Expected branch [remoteUrl [token]]');
  const [branch, remote = old?.remoteUrl, token] = parts;
  const url = new URL(remote); if (url.protocol !== 'https:' || url.username || url.password || !/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error('Use a valid branch and an HTTPS remote without credentials.');
  const stage = path.join(config.dataDir, 'git-stage', randomUUID()); fs.mkdirSync(stage, { recursive: true });
  const tokenPath = path.join(stage, 'token'); if (token) fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  let resume;
  try {
    try { await runGit(stage, ['clone', '--single-branch', '--branch', branch, '--', remote, 'repo'], gitAuth(token ? tokenPath : old?.secretRef)); }
    catch (error) { throw gitSetupError(error); }
    const repo = path.join(stage, 'repo'); if (fs.existsSync(path.join(repo, '.temp'))) throw new Error('Remote must not contain .temp');
    resume = await pauseBot(botId);
    const root = path.join(config.botsDir, botId); fs.mkdirSync(root, { recursive: true });
    for (const name of fs.readdirSync(root)) if (name !== '.temp') fs.rmSync(path.join(root, name), { recursive: true, force: true });
    for (const name of fs.readdirSync(repo)) fs.cpSync(path.join(repo, name), path.join(root, name), { recursive: true, dereference: false });
    let secretRef = old?.secretRef ?? null;
    if (token) { fs.mkdirSync(path.join(config.dataDir, 'secrets'), { recursive: true, mode: 0o700 }); secretRef = path.join(config.dataDir, 'secrets', botId + '.git-token'); fs.writeFileSync(secretRef, token, { mode: 0o600 }); }
    db.sql.prepare('INSERT INTO git_settings VALUES(?,?,?,?) ON CONFLICT(botId) DO UPDATE SET branch=excluded.branch,remoteUrl=excluded.remoteUrl,secretRef=excluded.secretRef').run(botId, branch, remote, secretRef);
    db.sql.prepare("INSERT INTO controller_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('wiki_updated:' + botId, new Date().toISOString());
    return { branch, remoteUrl: remote, status: 'synced' };
  } finally { resume?.(); fs.rmSync(stage, { recursive: true, force: true }); }
}
