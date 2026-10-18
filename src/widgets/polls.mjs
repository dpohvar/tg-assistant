export function observePoll(store,w,poll) {
  store.patchView(w,w.view.id,{message:{...w.view.message,poll}});
}
export function observePollAnswer(db,store,w,answer) {
  const voter=answer.user?'user:'+answer.user.id:answer.voter_chat?'chat:'+answer.voter_chat.id:null;
  if(!voter)return;
  const sql=db.sql,pollId=w.view.pollId;
  let evicted=w.view.message?.pollAnswers?.evicted??0;
  db.transaction(()=>{
    sql.prepare('INSERT INTO widget_poll_answers(widgetId,pollId,voter,json,receivedAt) VALUES(?,?,?,?,?) ON CONFLICT(widgetId,pollId,voter) DO UPDATE SET json=excluded.json,receivedAt=excluded.receivedAt').run(w.widgetId,pollId,voter,JSON.stringify(answer),Date.now());
    for(;;) {
      const size=sql.prepare('SELECT count(*) n,COALESCE(sum(length(CAST(json AS BLOB))),0) bytes FROM widget_poll_answers WHERE widgetId=? AND pollId=?').get(w.widgetId,pollId);
      if(size.n<=1000&&size.bytes<=256*1024)break;
      sql.prepare('DELETE FROM widget_poll_answers WHERE widgetId=? AND pollId=? AND voter=(SELECT voter FROM widget_poll_answers WHERE widgetId=? AND pollId=? ORDER BY receivedAt,voter LIMIT 1)').run(w.widgetId,pollId,w.widgetId,pollId);evicted++;
    }
    const known=sql.prepare('SELECT json FROM widget_poll_answers WHERE widgetId=? AND pollId=? ORDER BY receivedAt,voter').all(w.widgetId,pollId).map(row=>JSON.parse(row.json));
    store.patchView(w,w.view.id,{message:{...store.getView(w.view.id).message,pollAnswers:{known,complete:false,evicted}}});
  });
}
