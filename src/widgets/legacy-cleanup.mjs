/** Best-effort retirement of confirmed legacy publications after schema upgrade. */
export async function runLegacyCleanup({ db, telegram, authorize }) {
  if (typeof telegram?.editMessageReplyMarkup !== "function" || typeof authorize !== "function")
    throw new TypeError("Legacy cleanup requires a Telegram edit adapter and authorization check.");
  const jobs = db.sql.prepare("SELECT * FROM widget_legacy_cleanup WHERE status!='done' ORDER BY createdAt,jobId").all();
  const result = { done: 0, failed: 0 };
  for (const job of jobs) {
    const target = JSON.parse(job.target);
    try {
      if (!await authorize({ botId: job.botId, agentId: job.agentId, target }))
        throw new Error("Legacy cleanup target is no longer authorized.");
      const address = target.inlineMessageId
        ? { inline_message_id: target.inlineMessageId }
        : { chat_id: target.chatId, message_id: target.messageId };
      await telegram.editMessageReplyMarkup(job.botId, {
        ...address,
        reply_markup: { inline_keyboard: [] },
      });
      db.sql.prepare("UPDATE widget_legacy_cleanup SET status='done',attempts=attempts+1,lastError=NULL WHERE jobId=?")
        .run(job.jobId);
      result.done++;
    } catch (error) {
      db.sql.prepare("UPDATE widget_legacy_cleanup SET status='failed',attempts=attempts+1,lastError=? WHERE jobId=?")
        .run(String(error?.message ?? error).slice(0, 1000), job.jobId);
      result.failed++;
    }
  }
  return result;
}
