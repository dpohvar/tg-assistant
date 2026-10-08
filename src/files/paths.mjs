import fs from 'node:fs';
import path from 'node:path';
export class BotFiles {
  images = new Map();
  constructor(root, agentId, { admin = false } = {}) { fs.mkdirSync(root, { recursive: true }); this.root = fs.realpathSync(root); this.agentId = agentId; this.admin = admin; }
  parts(input) {
    if (typeof input !== 'string') throw new Error('Invalid file path');
    const relative = path.isAbsolute(input) ? path.relative(this.root, input) : input;
    const parts = relative.split(/[\\/]/).filter(p => p && p !== '.');
    if (parts.some(p => p === '..' || p.startsWith('.') && p !== '.temp') || parts[0] === '.temp' && !this.admin && parts[1] !== this.agentId) throw new Error('File path is outside the permitted area');
    return parts;
  }
  withParent(input, create, callback) {
    const parts = this.parts(input), filename = parts.pop(); if (!filename) throw new Error('A file name is required');
    const handles = [];
    try {
      let dir = this.root;
      if (process.platform === 'linux') { const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd); dir = `/proc/self/fd/${fd}`; }
      for (const part of parts) {
        const next = path.join(dir, part); if (create && !fs.existsSync(next)) fs.mkdirSync(next);
        if (process.platform === 'linux') { const fd = fs.openSync(next, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd); dir = `/proc/self/fd/${fd}`; }
        else { if (fs.lstatSync(next).isSymbolicLink()) throw new Error('Symlinks are not permitted'); dir = next; }
      }
      return callback(path.join(dir, filename));
    } finally { for (const fd of handles.reverse()) fs.closeSync(fd); }
  }
  read(input) { return this.withParent(input, false, p => { if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Symlinks are not permitted'); const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); try { if (!fs.fstatSync(fd).isFile()) throw new Error('Not a regular file'); return fs.readFileSync(fd); } finally { fs.closeSync(fd); } }); }
  write(input, bytes, exclusive = false) { return this.withParent(input, true, p => { const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC) | (fs.constants.O_NOFOLLOW ?? 0); const fd = fs.openSync(p, flags, 0o600); try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); } }); }
  registerImage(threadId, source) { if (!this.images.has(threadId)) this.images.set(threadId, new Set()); this.images.get(threadId).add(source); }
  list(input = '.') { const p = this.parts(input); if (!p.length) return fs.readdirSync(this.root); return this.withParent([...p, 'placeholder'].join('/'), false, filename => fs.readdirSync(path.dirname(filename))); }
  remove(input) { this.withParent(input, false, p => fs.rmSync(p, { recursive: true, force: true })); }
  move(from, to) { this.withParent(from, false, source => this.withParent(to, true, dest => fs.renameSync(source, dest))); }
  saveImage(threadId, source, dir = `.temp/${this.agentId}/upload`) {
    if (![...this.images.values()].some(paths => paths.has(source))) throw new Error('Unregistered image source');
    if (path.isAbsolute(dir)) throw new Error('Image destination must be relative to the bot directory');
    this.parts(dir); const destination = path.posix.join(dir.replaceAll('\\', '/'), path.basename(source));
    const bytes = fs.readFileSync(source);
    try { this.write(destination, bytes, true); } catch (e) { if (e.code !== 'EEXIST' || !this.read(destination).equals(bytes)) throw e; }
    return { path: destination };
  }
}
