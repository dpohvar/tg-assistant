// Runs within openDatabase's upgrade transaction, before any runtime starts.
export function migrateWidgets(sql){
  for(const row of sql.prepare('SELECT state FROM widgets').all())JSON.parse(row.state);
  const views=new Map(sql.prepare('SELECT * FROM widget_views').all().map(v=>[v.widgetId,v]));
  for(const v of views.values())for(const field of ['props','message','renderSpec','buttonNames'])if(v[field]!==null)JSON.parse(v[field]);
  for(const row of sql.prepare('SELECT * FROM widget_events').all()){
    const event=JSON.parse(row.payload),v=views.get(row.widgetId);let admission=null;
    if(v&&['button','reply','reaction','poll','poll_answer'].includes(event.source)){
      const target={chatId:v.chatId,messageId:v.messageId};
      event.view={id:v.viewId,target,props:JSON.parse(v.props)};
      admission={viewId:v.viewId,bindingEpoch:v.bindingEpoch,target,
        ...(event.source==='button'?{callbackData:event.data?.data}:{}),
        ...(['poll','poll_answer'].includes(event.source)?{pollId:v.pollId}:{})};
    }
    const payload=JSON.stringify(event),control=sql.prepare('SELECT state FROM widget_control_jobs WHERE widgetId=? AND seq=?').get(row.widgetId,row.seq);
    sql.prepare('UPDATE widget_events SET payload=?,bytes=?,admission=? WHERE widgetId=? AND seq=?')
      .run(payload,Buffer.byteLength(payload)+Buffer.byteLength(control?.state??''),admission?JSON.stringify(admission):null,row.widgetId,row.seq);
  }
}
