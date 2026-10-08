import { setTimeout as delay } from 'node:timers/promises';
export async function poll({ botId, telegram, signal, getOffset, setOffset, receive, onError = () => {} }) {
  let retry = 500;
  while (!signal.aborted) {
    try {
      const events = await telegram.call(botId, 'getUpdates', { offset: getOffset(), timeout: 30, allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'callback_query', 'my_chat_member', 'message_reaction', 'message_reaction_count'] }, { signal });
      for (const event of events) { if (signal.aborted) break; await receive(botId, event); setOffset(event.update_id + 1); }
      retry = 500;
    } catch (error) {
      if (signal.aborted) break;
      onError(error.code ?? 'poll_failed');
      try { await delay(Math.max(retry, (error.retryAfter ?? 0) * 1000), undefined, { signal }); } catch { break; }
      retry = Math.min(retry * 2, 30000);
    }
  }
}
