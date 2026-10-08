import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const supportedCodexVersion = '0.159.3';
export async function verifyCodexVersion(executable) {
  const { stdout } = await promisify(execFile)(executable, ['--version'], { timeout: 10000, windowsHide: true });
  if (stdout.trim() !== `codex-cli ${supportedCodexVersion}`) throw new Error(`Codex must be ${supportedCodexVersion}; validate the runtime before upgrading.`);
}
