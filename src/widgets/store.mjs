import {randomUUID} from 'node:crypto';
import {WIDGET_LIMITS as L,validateWidgetState,validateWidgetEvent,widgetError,plainJSON} from './contract.mjs';
import {createWidgetViews} from './views.mjs';
export function createWidgetStore(db){
  const sql=db.sql;
  function decode(row){if(!row)return null;const q=sql.prepare('SELECT count(*) pending,COALESCE(sum(bytes),0) pendingBytes FROM widget_events WHERE widgetId=? AND started=0').get(row.widgetId);
    return {...row,state:JSON.parse(row.state),lastError:row.lastError?JSON.parse(row.lastError):null,...q};}
  const get=id=>decode(sql.prepare('SELECT * FROM widgets WHERE widgetId=?').get(id));
  function current(ref){const w=get(ref.widgetId);if(!w||w.botId!==ref.botId||w.agentId!==ref.agentId||w.generation!==ref.generation||w.lifecycleIntent==='delete')throw widgetError('widget_stopped');return w;}
  function admit(ref,event,{controlState,durable=true,control=false,admission}={}){
    const json=validateWidgetEvent(event,{control}),state=controlState===undefined?null:validateWidgetState(controlState),meta=admission?plainJSON(admission):null;
    const bytes=Buffer.byteLength(json)+Buffer.byteLength(state??'')+Buffer.byteLength(meta??'');
    return db.transaction(()=>{const w=current(ref);if(w.status!=='active')throw widgetError('widget_stopped');
      if(w.pending>=L.pending||w.pendingBytes+bytes>L.pendingBytes){sql.prepare('UPDATE widgets SET dropped=dropped+1 WHERE widgetId=?').run(w.widgetId);return {accepted:false,reason:'queue_full'};}
      const seq=w.sequence+1;sql.prepare('UPDATE widgets SET sequence=? WHERE widgetId=?').run(seq,w.widgetId);
      sql.prepare('INSERT INTO widget_events(widgetId,seq,payload,bytes,durable,admission) VALUES(?,?,?,?,?,?)').run(w.widgetId,seq,json,bytes,+durable,meta);
      if(event.name==='__render')sql.prepare('INSERT INTO widget_control_jobs VALUES(?,?,?)').run(w.widgetId,seq,state);return {accepted:true,seq};});
  }
  const store={get,current,
    list({botId,agentId}={}){return sql.prepare(`SELECT * FROM widgets WHERE botId=?${agentId?' AND agentId=?':''} ORDER BY createdAt,widgetId`).all(...(agentId?[botId,agentId]:[botId])).map(decode);},
    create(input){const state=validateWidgetState(input.state??{});return db.transaction(()=>{
      if(sql.prepare('SELECT count(*) n FROM widgets WHERE botId=? AND agentId=?').get(input.botId,input.agentId).n>=L.widgets)throw widgetError('widget_quota');
      const id=input.widgetId??'w'+randomUUID().replaceAll('-','');
      sql.prepare(`INSERT INTO widgets(widgetId,botId,agentId,status,handler,snapshotId,description,state,createdAt,lifecycleIntent)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,input.botId,input.agentId,input.status??'active',input.handler,input.snapshotId,input.description,state,Date.now(),input.lifecycleIntent??null);return get(id);});},
    save(ref,{state}){const json=validateWidgetState(state);current(ref);sql.prepare('UPDATE widgets SET state=? WHERE widgetId=?').run(json,ref.widgetId);},
    patch(ref,fields){current(ref);const allowed=new Set(['status','handler','snapshotId','description','stoppedReason','lifecycleIntent','lastError']);
      const keys=Object.keys(fields);if(keys.some(key=>!allowed.has(key)))throw widgetError('invalid_argument');if(!keys.length)return get(ref.widgetId);
      sql.prepare(`UPDATE widgets SET ${keys.map(key=>key+'=?').join(',')} WHERE widgetId=?`).run(...keys.map(key=>key==='lastError'&&fields[key]!==null?plainJSON(fields[key]):fields[key]),ref.widgetId);return get(ref.widgetId);},
    replace(ref,fields,{keepPending=false,keepEphemeral=false}={}){return db.transaction(()=>{current(ref);
      sql.prepare('DELETE FROM widget_events WHERE widgetId=?'+(keepPending?(keepEphemeral?' AND started=1':' AND (started=1 OR durable=0)'):'')).run(ref.widgetId);
      this.patch(ref,fields);if(keepPending)sql.prepare("UPDATE widget_events SET payload=json_set(payload,'$.delayed',json('true')) WHERE widgetId=?").run(ref.widgetId);
      sql.prepare('UPDATE widgets SET generation=generation+1 WHERE widgetId=?').run(ref.widgetId);return get(ref.widgetId);});},
    admit,
    admitRender(ref,state){return admit(ref,{name:'__render',source:'agent',receivedAt:new Date().toISOString(),delayed:false,data:{}},{controlState:state,control:true});},
    head(ref,{debugOnly=false}={}){current(ref);const row=sql.prepare(`SELECT * FROM widget_events WHERE widgetId=? AND started=0 ${debugOnly?"AND json_extract(payload,'$.name')='__render'":''} ORDER BY seq LIMIT 1`).get(ref.widgetId);
      return row?{...row,event:JSON.parse(row.payload),admission:row.admission?JSON.parse(row.admission):null}:null;},
    begin(ref,seq){current(ref);return db.transaction(()=>{const row=sql.prepare('SELECT payload FROM widget_events WHERE widgetId=? AND seq=? AND started=0').get(ref.widgetId,seq);
      if(!row)throw widgetError('widget_stopped','Event already started.');sql.prepare('UPDATE widget_events SET started=1 WHERE widgetId=? AND seq=?').run(ref.widgetId,seq);
      const event=JSON.parse(row.payload);if(event.name==='__render'){const job=sql.prepare('SELECT state FROM widget_control_jobs WHERE widgetId=? AND seq=?').get(ref.widgetId,seq);event.data=job?.state?{state:JSON.parse(job.state)}:{};}return event;});},
    complete(ref,seq){current(ref);sql.prepare('DELETE FROM widget_events WHERE widgetId=? AND seq=?').run(ref.widgetId,seq);},
    drop(ref,seq){this.complete(ref,seq);sql.prepare('UPDATE widgets SET dropped=dropped+1 WHERE widgetId=?').run(ref.widgetId);},
    clearPending(ref){sql.prepare('DELETE FROM widget_events WHERE widgetId=? AND started=0').run(ref.widgetId);},
    disableOwner({botId,agentId},reason){return db.transaction(()=>{sql.prepare("UPDATE widgets SET status='stopped',stoppedReason=? WHERE botId=? AND agentId=?").run(reason,botId,agentId);
      sql.prepare('DELETE FROM widget_events WHERE widgetId IN (SELECT widgetId FROM widgets WHERE botId=? AND agentId=?)').run(botId,agentId);});},
    deletionIntent(ref){current(ref);sql.prepare("UPDATE widgets SET lifecycleIntent='delete' WHERE widgetId=?").run(ref.widgetId);},
    remove(widgetId){sql.prepare('DELETE FROM widgets WHERE widgetId=?').run(widgetId);},
    recovery(){const uncertain=sql.prepare('SELECT DISTINCT widgetId FROM widget_events WHERE started=1').all().map(x=>x.widgetId);
      db.transaction(()=>{sql.exec("DELETE FROM widgets WHERE lifecycleIntent='delete';DELETE FROM widget_events WHERE started=1 OR durable=0 OR widgetId IN (SELECT widgetId FROM widgets WHERE status='stopped');UPDATE widget_events SET payload=json_set(payload,'$.delayed',json('true'))");});return uncertain;}
  };
  Object.assign(store,createWidgetViews({db,widgets:store}));return store;
}
