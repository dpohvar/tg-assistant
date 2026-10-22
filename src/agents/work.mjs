import {randomUUID} from 'node:crypto';
export function createWorkStore(db,{now=Date.now}={}) {
 const sql=db.sql,get=id=>{if(!id)return null;const row=sql.prepare('SELECT * FROM agent_work WHERE workId=?').get(id);return row?{...JSON.parse(row.data),...row}:null;};
 const update=(id,patch,state)=>{const row=get(id);if(!row)return;const data={...row,...patch};delete data.data;sql.prepare('UPDATE agent_work SET data=?,state=?,updatedAt=? WHERE workId=?').run(JSON.stringify(data),state??row.state,now(),id);};
 return {get,
  begin(scope,origins=[]){const id=randomUUID();sql.prepare('INSERT INTO agent_work VALUES(?,?,?,?,?)').run(id,scope.agentId,'running',JSON.stringify({epoch:scope.generation,origins,turns:[]}),now());return id;},
  addOrigins(id,origins){const row=get(id);update(id,{origins:[...row.origins,...origins]});},
  bindTurn(id,identity){const row=get(id);if(!row)return;if(row.turns.some(t=>t.threadId===identity.threadId&&(!identity.turnId||t.turnId===identity.turnId)))return;update(id,{turns:[...row.turns.filter(t=>t.threadId!==identity.threadId||t.turnId),identity]});},
  suspend(id,operationId){update(id,{operationId},'suspended');},
  resume(id,identity){update(id,{...(identity?{resumeIdentity:identity}:{})},'running');},
  finish(id,outcome){const row=get(id);if(!row||!['running','suspended'].includes(row.state))return false;update(id,{},outcome);return true;},
  open(id){return sql.prepare("SELECT workId FROM agent_work WHERE agentId=? AND state IN ('running','suspended')").all(id).map(r=>get(r.workId));},
  cleanup(at=now()){sql.prepare("DELETE FROM agent_work WHERE updatedAt<? AND state NOT IN ('running','suspended')").run(at-30*86400000);}
 };
}
