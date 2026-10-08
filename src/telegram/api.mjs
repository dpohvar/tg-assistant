export function createTelegram({ getToken, fetch = globalThis.fetch }) {
  return {
    getToken,
    async call(botId, method, args = {}, { signal, uploads = [] } = {}) {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(method)) throw new Error('Invalid Telegram method');
      const token = await getToken(botId);
      if (!token) throw Object.assign(new Error('Bot token is not configured.'), { code: 'bot_not_configured' });
      let body, headers;
      if (uploads.length) {
        body = new FormData();
        for (const [key, value] of Object.entries(args)) if (value !== undefined) body.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        for (const { name, bytes, filename, mime } of uploads) body.append(name, new Blob([bytes], { type: mime ?? 'application/octet-stream' }), filename);
      } else { body = JSON.stringify(args); headers = { 'Content-Type': 'application/json' }; }
      let data;
      try { const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body, headers, signal: signal ?? AbortSignal.timeout(method === 'getUpdates' ? 65000 : 120000) }); data = await response.json(); }
      catch { throw Object.assign(new Error('Telegram request failed. Its outcome may be unknown; check before repeating.'), { code: 'telegram_transport_failed' }); }
      if (!data.ok) throw Object.assign(new Error(String(data.description ?? 'Telegram rejected the request.').replaceAll(token, '[redacted]')), { code: 'telegram_api_error', retryAfter: data.parameters?.retry_after });
      return data.result;
    },
  };
}
