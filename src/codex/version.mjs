import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const supportedCodexVersion = '0.159.3';
export async function verifyCodexVersion(executable, warn = console.warn) {
  const { stdout } = await promisify(execFile)(executable, ['--version'], { timeout: 10000, windowsHide: true });
  if (stdout.trim() !== `codex-cli ${supportedCodexVersion}`) warn(`Warning: detected ${stdout.trim()}; validated Codex version is ${supportedCodexVersion}. Continuing startup with an unvalidated runtime.`);
}
