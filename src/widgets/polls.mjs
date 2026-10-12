export function observePoll(store, w, poll) {
  store.patch(w, { message: { ...w.message, poll } });
}
export function observePollAnswer(db, store, w, answer) {
  const voter = answer.user
    ? "user:" + answer.user.id
    : answer.voter_chat
      ? "chat:" + answer.voter_chat.id
      : null;
  if (!voter) return;
  const sql = db.sql;
  let evicted = w.message?.pollAnswers?.evicted ?? 0;
  db.transaction(() => {
    sql
      .prepare(
        "INSERT INTO widget_poll_answers(widgetId,voter,json,receivedAt) VALUES(?,?,?,?) ON CONFLICT(widgetId,voter) DO UPDATE SET json=excluded.json,receivedAt=excluded.receivedAt",
      )
      .run(w.widgetId, voter, JSON.stringify(answer), Date.now());
    while (true) {
      const size = sql
        .prepare(
          "SELECT count(*) n,COALESCE(sum(length(CAST(json AS BLOB))),0) bytes FROM widget_poll_answers WHERE widgetId=?",
        )
        .get(w.widgetId);
      if (size.n <= 1000 && size.bytes <= 256 * 1024) break;
      sql
        .prepare(
          "DELETE FROM widget_poll_answers WHERE widgetId=? AND voter=(SELECT voter FROM widget_poll_answers WHERE widgetId=? ORDER BY receivedAt,voter LIMIT 1)",
        )
        .run(w.widgetId, w.widgetId);
      evicted++;
    }
    const known = sql
      .prepare(
        "SELECT json FROM widget_poll_answers WHERE widgetId=? ORDER BY receivedAt,voter",
      )
      .all(w.widgetId)
      .map((x) => JSON.parse(x.json));
    store.patch(w, {
      message: {
        ...store.get(w.widgetId).message,
        pollAnswers: { known, complete: false, evicted },
      },
    });
  });
}
