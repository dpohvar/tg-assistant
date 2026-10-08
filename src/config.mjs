import fs from 'node:fs';
import path from 'node:path';
export function loadConfig(filename) {
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Number.isSafeInteger(config.serviceOwnerId) || config.serviceOwnerId <= 0) throw new Error('serviceOwnerId must be a positive safe integer');
  for (const key of ['dataDir', 'botsDir', 'codexHome', 'codexExecutable']) if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) throw new Error(`${key} must be an absolute path`);
  if (!config.masterTokenFile || !path.isAbsolute(config.masterTokenFile)) throw new Error('masterTokenFile must be an absolute path');
  const inside = (parent, candidate) => { const relative = path.relative(path.resolve(parent), path.resolve(candidate)); return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative); };
  for (const secretRoot of [config.dataDir, config.codexHome, config.masterTokenFile]) if (inside(config.botsDir, secretRoot)) throw new Error('Controller data, auth and secrets must be outside the bot directory tree.');
  for (const protectedPath of [config.dataDir, config.botsDir, config.codexHome, config.masterTokenFile]) if (inside(path.dirname(config.codexExecutable), protectedPath)) throw new Error('Codex executable directory must not contain controller data, bot directories, auth or secrets.');
  new Intl.DateTimeFormat('en', { timeZone: config.defaultTimezone ?? 'UTC' });
  return { defaultModel: 'gpt-6.1-sol', defaultTimezone: 'UTC', ...config };
}
