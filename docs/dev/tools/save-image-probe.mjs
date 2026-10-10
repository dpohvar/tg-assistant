// Bounded runtime-test adapter, not the production filesystem implementation.
import fs from 'node:fs';
import path from 'node:path';

export function createImageSaver(botDirectory, agentId) {
  const root = fs.realpathSync(botDirectory);
  const registered = new Map();
  return {
    register(threadId, savedPath) {
      registered.set(`${threadId}\n${savedPath}`, fs.realpathSync(savedPath));
    },
    save(threadId, savedPath, dir = `.temp/${agentId}/upload`) {
      const source = registered.get(`${threadId}\n${savedPath}`);
      if (!source) throw new Error('unregistered image for this thread');
      if (typeof dir !== 'string' || path.isAbsolute(dir) || dir.includes('\\')) throw new Error('invalid destination');
      const parts = dir === '.' ? [] : dir.split('/');
      if (parts.some(p => !p || p === '.' || p === '..') ||
          parts.some((p, i) => p.startsWith('.') && !(i === 0 && p === '.temp')) ||
          parts[0] === '.temp' && parts[1] !== agentId) throw new Error('forbidden destination');
      // Refuse symlink components, including the output file; never overwrite.
      let destination = root;
      const components = [...parts, path.basename(source)];
      for (const [index, part] of components.entries()) {
        destination = path.join(destination, part);
        let stat;
        try { stat = fs.lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat?.isSymbolicLink()) throw new Error('symlink destination');
        if (index < components.length - 1 && !stat) fs.mkdirSync(destination);
      }
      try { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); }
      catch (error) {
        if (error.code !== 'EEXIST' || !fs.readFileSync(source).equals(fs.readFileSync(destination))) throw error;
      }
      return { path: path.relative(root, destination).split(path.sep).join('/') };
    },
  };
}
