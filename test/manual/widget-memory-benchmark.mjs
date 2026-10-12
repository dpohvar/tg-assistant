// Manual synthetic probe; no Telegram, application runtime, or sandbox wrapper.
// node --expose-gc test/manual/widget-memory-benchmark.mjs > result.json
import { fork, execFileSync } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const filename = fileURLToPath(import.meta.url);
const allocations = [];
function widget(bytes) {
  const state = { votes: {}, page: 0, text: 'x'.repeat(32 * 1024) };
  const buffer = Buffer.alloc(bytes, 123); // Touch pages, not just reserve space.
  allocations.push({ state, buffer });
  setInterval(() => { state.page++; JSON.stringify(state); }, 1000);
}

if (!isMainThread) {
  widget(workerData.bytes);
  global.gc?.();
  parentPort.postMessage('ready');
} else if (process.argv[2] === 'host') {
  const [mode, count, bytes] = [process.argv[3], +process.argv[4], +process.argv[5]];
  if (mode === 'workers') {
    await Promise.all(Array.from({ length: count }, () => new Promise((resolve, reject) => {
      const worker = new Worker(filename, { workerData: { bytes } });
      worker.once('message', resolve);
      worker.once('error', reject);
    })));
  } else {
    for (let i = 0; i < count; i++) widget(bytes);
  }
  global.gc?.();
  // Keep baseline alive too. Outer runner owns termination.
  setInterval(() => {}, 60_000);
  process.send({ ready: true });
  process.on('message', message => {
    if (message === 'sample') process.send({ memory: process.memoryUsage() });
  });
} else {
  const rows = [];
  async function launch(mode, count, bytes) {
    const child = fork(filename, ['host', mode, String(count), String(bytes)], {
      execArgv: ['--expose-gc'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Host exited: ${code}`)));
    });
    return child;
  }
  function osMemory(children) {
    if (process.platform === 'win32') {
      const ids = children.map(child => child.pid).join(',');
      const value = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `@(Get-Process -Id ${ids} | Select-Object Id,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress`],
        { encoding: 'utf8', windowsHide: true }));
      const entries = Array.isArray(value) ? value : [value];
      return { rss: entries.reduce((n, p) => n + p.WorkingSet64, 0),
        privateCommit: entries.reduce((n, p) => n + p.PrivateMemorySize64, 0) };
    }
    let rss = 0, pss = 0, privateResident = 0;
    for (const child of children) {
      const data = readFileSync(`/proc/${child.pid}/smaps_rollup`, 'utf8');
      const kb = name => +(data.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
      rss += kb('Rss'); pss += kb('Pss');
      privateResident += kb('Private_Clean') + kb('Private_Dirty');
    }
    return { rss, pss, privateResident };
  }
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const bytes of [0, 8 * 1024 * 1024]) {
      for (const count of [1, 5]) {
        for (const mode of ['processes', 'workers', 'shared']) {
          const children = [];
          try {
            if (mode === 'processes') {
              for (let i = 0; i < count; i++) children.push(await launch('shared', 1, bytes));
            } else children.push(await launch(mode, count, bytes));
            await delay(1600);
            const metrics = osMemory(children);
            rows.push({ repeat, mode, count, bytesPerWidget: bytes, ...metrics });
          } finally {
            await Promise.all(children.map(child => new Promise(resolve => {
              child.once('exit', resolve); child.kill();
            })));
          }
        }
      }
    }
    const child = await launch('shared', 0, 0);
    try {
      await delay(1600);
      rows.push({ repeat, mode: 'baseline', count: 0, bytesPerWidget: 0, ...osMemory([child]) });
    } finally {
      await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    }
  }
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch,
    node: process.version, rows }, null, 2));
}
