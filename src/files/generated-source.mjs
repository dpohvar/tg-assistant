import fs from 'node:fs';
import path from 'node:path';
import { BotFiles } from './paths.mjs';
export function generatedSource(config, source) {
  if (!config.codexHome || !path.isAbsolute(source)) throw new Error('Invalid generated image source');
  const root = path.join(config.codexHome, 'generated_images'), relative = path.relative(root, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid generated image source');
  return { root, relative };
}
export function expireGenerated(config, source, now, force = false) {
  const { root, relative } = generatedSource(config, source);
  try {
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Invalid generated image directory');
    return new BotFiles(root, 'controller').withParent(relative, false, filename => {
      const stat = fs.lstatSync(filename);
      if (!stat.isFile()) throw new Error('Invalid generated image file');
      if (!force && stat.mtimeMs >= now - 86400000) return false;
      fs.unlinkSync(filename); return true;
    });
  } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
