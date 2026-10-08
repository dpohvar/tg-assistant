import { createHash } from 'node:crypto';
export function findFile(value, id) { if (!value || typeof value !== 'object') return null; if (value.file_id === id) return value; for (const v of Object.values(value)) { const file = findFile(v, id); if (file) return file; } return null; }
export function createDownload({ telegram, getToken, filesFor, fetch = globalThis.fetch }) {
  const inflight = new Map();
  return async (scope, { fileIds } = {}) => {
    if (!Array.isArray(fileIds) || fileIds.some(id => typeof id !== 'string' || !id.length)) return { error: 'invalid_argument', description: 'fileIds must be an array of non-empty Telegram file ID strings.' };
    const results = [];
    for (const fileId of fileIds) {
      const request = { fileId };
      const hash = createHash('sha256').update(fileId).digest('hex'), name = 'attachment';
      const relative = `.temp/${scope.agentId}/download/${hash}-${name}`, store = filesFor(scope);
      try {
        try { store.read(relative); } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          const key = `${scope.botId}:${scope.agentId}:${hash}`;
          if (!inflight.has(key)) inflight.set(key, (async () => {
            const file = await telegram.call(scope.botId, 'getFile', { file_id: request.fileId });
            const response = await fetch(`https://api.telegram.org/file/bot${await getToken(scope.botId)}/${file.file_path}`, { signal: AbortSignal.timeout(120000) });
            if (!response.ok) throw new Error('Download rejected'); store.write(relative, Buffer.from(await response.arrayBuffer()), true);
          })().finally(() => inflight.delete(key)));
          await inflight.get(key);
        }
        results.push({ ...request, path: `${store.root}/${relative}` });
      } catch { results.push({ ...request, error: 'file_unavailable', description: 'Telegram file download or local storage failed. Retry after checking file availability.' }); }
    }
    return { files: results };
  };
}
