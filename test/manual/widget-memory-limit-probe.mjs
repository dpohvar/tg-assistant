// Bounded allocation probe. No production service or Telegram access.
// buffers: prove Buffer allocations exceed --max-old-space-size.
// monitor: demonstrate an external RSS watchdog, not a hard ceiling.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const filename = fileURLToPath(import.meta.url);
if (process.argv[2] === 'monitor') {
  const child = spawn(process.execPath, ['--max-old-space-size=64', filename, 'buffers', '800'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', peak = 0, killed = false;
  child.stdout.on('data', d => stdout += d);
  child.stderr.on('data', d => stderr += d);
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 15000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    try {
      const rss = process.platform === 'win32'
        ? Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).WorkingSet64`], { encoding: 'utf8', windowsHide: true }).trim())
        : Number(readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)[1]) * 1024;
      peak = Math.max(peak, rss);
      if (rss > 128 * 1024 * 1024) { killed = true; child.kill(); break; }
    } catch { break; }
    await delay(100);
  }
  child.kill();
  const result = await exit;
  console.log(JSON.stringify({ platform: process.platform, node: process.version, thresholdMiB: 128,
    peakObservedMiB: peak / 1048576, killedForMemory: killed, ...result, stdout, stderr }));
} else {
  await delay(Number(process.argv[3] ?? 0));
  const retained = [];
  try {
    for (let i = 0; i < 40; i++) {
      retained.push(Buffer.alloc(8 * 1024 * 1024, 123));
      if (i % 4 === 3) console.log(JSON.stringify({ buffersMiB: retained.length * 8, ...process.memoryUsage() }));
      await delay(50);
    }
    console.log(JSON.stringify({ completed: true, retainedMiB: retained.length * 8, ...process.memoryUsage() }));
  } catch (error) {
    console.log(JSON.stringify({ allocationFailed: true, retainedMiB: retained.length * 8, error: error.message }));
    process.exitCode = 2;
  }
}
