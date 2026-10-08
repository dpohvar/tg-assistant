import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
export function acquireLock(filename) {
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  const checkOwner = () => {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error('Invalid controller lock; inspect it manually.'); }
    const pid = typeof owner === 'number' ? owner : owner?.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid controller lock; inspect it manually.');
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    throw new Error('Another controller instance is running.');
  };
  const create = () => { const fd = fs.openSync(filename, 'wx', 0o600); try { fs.writeFileSync(fd, identity); } finally { fs.closeSync(fd); } };
  try { create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    checkOwner();
    const guard = filename + '.reclaim'; let handle;
    try { handle = fs.openSync(guard, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Controller lock recovery is already in progress; inspect a stale recovery guard manually.'); throw error; }
    try {
      fs.writeFileSync(handle, identity);
      const staleExists = checkOwner(); // Recheck under the guard; never unlink an initially absent replacement.
      if (staleExists) fs.unlinkSync(filename);
      create(); // An ordinary starter may win the gap; never remove its replacement.
    } finally { fs.closeSync(handle); if (fs.readFileSync(guard, 'utf8') === identity) fs.unlinkSync(guard); }
  }
  return () => { try { if (fs.readFileSync(filename, 'utf8') === identity) fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
}
