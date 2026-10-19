import {randomUUID} from 'node:crypto';
import {plainJSON} from '../widgets/contract.mjs';
export const GUEST_TTL=30*86400000;
export const guestError=(code,message=code,extra={})=>Object.assign(new Error(message),{code,...extra});
const unavailable=()=>guestError('guest_request_unavailable','This guest request is unavailable to this agent or its local retention has expired.');

export function createGuestStore(db,{now=Date.now}={}) {
  const sql=db.sql;
  const request=row=>row?{...row,message:JSON.parse(row.message)}:null;
  const publication=row=>row?{...row,prepared:JSON.parse(row.prepared),outcome:row.outcome?JSON.parse(row.outcome):null}:null;
  function get(scope,id) {
    if(typeof id!=='string'||!id)throw unavailable();
    const row=sql.prepare('SELECT * FROM guest_requests WHERE guestRequestId=? AND botId=? AND agentId=? AND callerUserId=? AND expiresAt>?').get(id,scope.botId,scope.agentId,scope.chatId,now());
    if(!row)throw unavailable();return request(row);
  }
  return {
    get,
    record({botId,agentId,callerUserId,updateId,message}) {
      if(typeof message?.guest_query_id!=='string'||!message.guest_query_id||!Number.isSafeInteger(callerUserId)||callerUserId<=0)throw guestError('invalid_argument','A guest query and an identifiable caller are required.');
      return db.transaction(()=>{
        const existing=sql.prepare('SELECT * FROM guest_requests WHERE botId=? AND queryId=?').get(botId,message.guest_query_id);
        if(existing)return {request:request(existing),created:false};
        const owner=sql.prepare('SELECT 1 FROM agents WHERE botId=? AND agentId=? AND chatId=?').get(botId,agentId,callerUserId);
        if(!owner)throw unavailable();
        const id='g'+randomUUID().replaceAll('-',''),at=now();
        sql.prepare('INSERT INTO guest_requests VALUES(?,?,?,?,?,?,?,?,?)').run(id,botId,agentId,callerUserId,message.guest_query_id,updateId??null,at,at+GUEST_TTL,plainJSON(message));
        return {request:request(sql.prepare('SELECT * FROM guest_requests WHERE guestRequestId=?').get(id)),created:true};
      });
    },
    beginPublication(scope,{guestRequestId,prepared,viewId}) {
      const req=get(scope,guestRequestId),id='gp'+randomUUID().replaceAll('-','');
      sql.prepare('INSERT INTO guest_publications(publicationId,guestRequestId,createdAt,expiresAt,viewId,prepared) VALUES(?,?,?,?,?,?)').run(id,req.guestRequestId,now(),req.expiresAt,viewId??null,plainJSON(prepared));
      return publication(sql.prepare('SELECT * FROM guest_publications WHERE publicationId=?').get(id));
    },
    saveOutcome(id,outcome) {
      if(!['confirmed','rejected','unknown'].includes(outcome?.status)||outcome.status==='confirmed'&&(typeof outcome.inlineMessageId!=='string'||!outcome.inlineMessageId))throw guestError('invalid_argument','A valid publication outcome is required.');
      sql.prepare('UPDATE guest_publications SET status=?,inlineMessageId=?,outcome=? WHERE publicationId=?').run(outcome.status,outcome.inlineMessageId??null,plainJSON(outcome),id);
    },
    publications(scope,id) {
      get(scope,id);
      return sql.prepare('SELECT * FROM guest_publications WHERE guestRequestId=? ORDER BY createdAt,rowid').all(id).map(publication);
    },
    cleanup(at=now()) {sql.prepare('DELETE FROM guest_requests WHERE expiresAt<=?').run(at);},
  };
}
