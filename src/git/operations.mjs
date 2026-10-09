import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const missing = () => ({ error: 'git_not_configured', description: 'Git is not configured for this bot. Ask the owner to run /git setup.' });
export function gitAuth(secretRef) { const script = fileURLToPath(new URL('./askpass.mjs', import.meta.url)); if (process.platform !== 'win32') fs.chmodSync(script, 0o755); return secretRef ? { TG_GIT_TOKEN_FILE: secretRef, GIT_ASKPASS: script.replaceAll('\\', '/') } : {}; }
export async function gitRun(root, args, env = {}) { const childEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...env }; for (const k of Object.keys(childEnv)) if (/^GIT_TRACE/.test(k)) delete childEnv[k]; const result = await run('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'credential.helper=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args], { cwd: root, env: childEnv, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); return result.stdout.trimEnd(); }
export async function gitChanges({ root, configured, branch }) {
  if (!configured) return missing();
  try {
    const status = await gitRun(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).temp']);
    const commits = await gitRun(root, ['log', '--format=%h %s', `refs/remotes/origin/${branch}..HEAD`]);
    return { files: status ? status.split('\n') : [], commits: commits ? commits.split('\n') : [] };
  } catch { return { error: 'git_failed', description: 'Local Git status could not be read. Check the repository and configured remote branch.' }; }
}
export async function gitSync(options, message) {
  if (!options.configured) return missing();
  let commit = null;
  try {
    await gitRun(options.root, ['rm', '-r', '-f', '--cached', '--ignore-unmatch', '--', '.temp']);
    await gitRun(options.root, ['add', '-A', '--', '.', ':(exclude).temp']);
    const staged = await gitRun(options.root, ['diff', '--cached', '--name-only']);
    if (staged) { if (!message?.trim()) return { error: 'invalid_argument', description: 'A commit message is required for modified files.' }; await gitRun(options.root, ['-c', 'user.name=Telegram Assistant', '-c', 'user.email=assistant@localhost', 'commit', '-m', message]); commit = await gitRun(options.root, ['rev-parse', '--short', 'HEAD']); }
    await gitRun(options.root, ['push', 'origin', `HEAD:refs/heads/${options.branch}`], options.env);
    return { commit, push: 'ok' };
  } catch { return { commit, push: 'failed', error: 'git_sync_failed', description: 'Git commit or push failed. Inspect git_changes before retrying; a local commit may already exist.' }; }
}
