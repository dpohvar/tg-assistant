import fs from 'node:fs';
import path from 'node:path';
export function cleanTemp(root, now = Date.now()) {
  const errors = [];
  if (process.platform === 'linux') {
    const openDirectory = name => fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const walkPinned = (fd, relative) => {
      const parent = `/proc/self/fd/${fd}`;
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        const file = path.join(parent, entry.name), logical = path.join(relative, entry.name);
        try {
          const stat = fs.lstatSync(file);
          if (stat.isDirectory()) {
            const child = openDirectory(file);
            try { walkPinned(child, logical); } finally { fs.closeSync(child); }
            try { fs.rmdirSync(file); } catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; }
          } else if (stat.mtimeMs < now - 86400000) fs.unlinkSync(file);
        } catch (error) { if (error.code !== 'ENOENT') errors.push(logical + ': deletion failed'); }
      }
    };
    let rootFd, tempFd;
    try { rootFd = openDirectory(root); tempFd = openDirectory(`/proc/self/fd/${rootFd}/.temp`); walkPinned(tempFd, '.temp'); }
    catch (error) { if (error.code !== 'ENOENT') errors.push('.temp: deletion failed'); }
    finally { if (tempFd !== undefined) fs.closeSync(tempFd); if (rootFd !== undefined) fs.closeSync(rootFd); }
    return errors;
  }
  const walk = dir => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    try { const stat = fs.lstatSync(file); if (stat.isDirectory()) { walk(file); if (!fs.readdirSync(file).length) fs.rmdirSync(file); } else if (stat.mtimeMs < now - 86400000) fs.unlinkSync(file); }
    catch { errors.push(path.relative(root, file) + ': deletion failed'); }
  } };
  if (fs.existsSync(path.join(root, '.temp')) && !fs.lstatSync(path.join(root, '.temp')).isSymbolicLink()) walk(path.join(root, '.temp'));
  return errors;
}
