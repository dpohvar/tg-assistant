import {randomUUID} from 'node:crypto';
export function createControlStore(db,{now=Date.now}={}) {
 const sql=db.sql,ensure=id=>sql.prepare('INSERT OR IGNORE INTO agent_control(agentId,updatedAt) VALUES(?,?)').run(id,now());
 const read=id=>{const row=sql.prepare('SELECT * FROM agent_control WHERE agentId=?').get(id);return row?{...row,notice:row.notice?JSON.parse(row.notice):null}:null;};
 const decode=row=>row?{...JSON.parse(row.data),...row,data:undefined}:null;
 const operation=id=>decode(sql.prepare('SELECT * FROM agent_compactions WHERE operationId=?').get(id));
 const active=id=>decode(sql.prepare("SELECT * FROM agent_compactions WHERE agentId=? AND (phase IN ('queued','submitting','running','unknown') OR continuationPhase IN ('pending','submitting','unknown')) ORDER BY updatedAt LIMIT 1").get(id));
 const patch=(id,fields)=>{ensure(id);const allowed=['epoch','phase','wake','notice'];for(const key of Object.keys(fields))if(!allowed.includes(key))throw Error('Invalid control field');sql.prepare(`UPDATE agent_control SET ${Object.keys(fields).map(k=>k+'=?').join(',')},updatedAt=? WHERE agentId=?`).run(...Object.entries(fields).map(([k,v])=>k==='notice'&&v!==null?JSON.stringify(v):v),now(),id);return read(id);};
 const transition=(id,expected,fields)=>{const op=operation(id);if(!op||![expected].flat().includes(op.phase))return false;const merged={...op,...fields};delete merged.data;sql.prepare('UPDATE agent_compactions SET phase=?,continuationPhase=?,data=?,updatedAt=? WHERE operationId=? AND phase=?').run(merged.phase,merged.continuationPhase,JSON.stringify(merged),now(),id,op.phase);return true;};
 return {
  read,patch,operation,active,
  reply(id){const row=sql.prepare('SELECT * FROM agent_control_replies WHERE replyId=?').get(id);return row?{...JSON.parse(row.data),phase:row.phase}:null;},
  prepareReply(agentId,replyId,request){const result=sql.prepare("INSERT OR IGNORE INTO agent_control_replies VALUES(?,?,'preparing',?,?)").run(replyId,agentId,JSON.stringify(request),now());return !!result.changes;},
  updateReply(replyId,phase,patch={}){const row=sql.prepare('SELECT * FROM agent_control_replies WHERE replyId=?').get(replyId);if(row)sql.prepare('UPDATE agent_control_replies SET phase=?,data=?,updatedAt=? WHERE replyId=?').run(phase,JSON.stringify({...JSON.parse(row.data),...patch}),now(),replyId);},
  pause(id,notice){return patch(id,{phase:'paused',wake:0,notice});},
  wake(id){return patch(id,{phase:'running',wake:0});},
  takeNotice(id){const notice=read(id)?.notice;if(notice)patch(id,{notice:null});return notice;},
  requestCompact(id,request){return db.transaction(()=>{ensure(id);const existing=active(id);if(existing)return existing;const operationId=randomUUID(),epoch=read(id).epoch,continuationPhase=request.continuation?'pending':'none';sql.prepare('INSERT INTO agent_compactions VALUES(?,?,?,?,?,?,?)').run(operationId,id,epoch,'queued',continuationPhase,JSON.stringify(request),now());return operation(operationId);});},
  transition,
  invalidate(id,reason){ensure(id);db.transaction(()=>{const c=read(id);patch(id,{epoch:c.epoch+1,notice:null});for(const row of sql.prepare('SELECT operationId FROM agent_compactions WHERE agentId=?').all(id)){const op=operation(row.operationId);if(['queued','submitting','running','unknown'].includes(op.phase)||['pending','submitting','unknown'].includes(op.continuationPhase))transition(op.operationId,op.phase,{phase:op.phase==='queued'?'cancelled':op.phase,continuationPhase:'cancelled',invalidated:reason});}});},
  pending(){return sql.prepare("SELECT * FROM agent_compactions WHERE phase IN ('queued','submitting','running','unknown') OR continuationPhase IN ('pending','submitting','accepted','unknown')").all().map(decode);},
  cleanup(at=now()){sql.prepare("DELETE FROM agent_compactions WHERE updatedAt<? AND phase IN ('succeeded','failed','cancelled') AND continuationPhase IN ('none','completed','cancelled')").run(at-30*86400000);sql.prepare("DELETE FROM agent_control_replies WHERE updatedAt<? AND phase='done'").run(at-30*86400000);}
 };
}
