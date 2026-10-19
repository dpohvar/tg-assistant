import {randomUUID} from 'node:crypto';
import {INLINE_POLICY,inlineError} from './contract.mjs';
const key=(botId,userId)=>JSON.stringify([botId,userId]);
export function createInlineRequests({now=Date.now,policy=INLINE_POLICY}={}){
  const current=new Map(),records=new Map(),cursors=new Map(),closedListeners=new Set();
  const notify=r=>{for(const fn of [...r.listeners])fn();};
  function close(requestId,reason='closed'){
    const r=records.get(requestId);if(!r||r.phase==='closed')return;
    r.phase='closed';r.reason=reason;delete r.query;delete r.prepared;delete r.pageTail;
    if(current.get(key(r.botId,r.userId))===r)current.delete(key(r.botId,r.userId));
    for(const token of r.cursors)cursors.delete(token);r.cursors.clear();records.delete(requestId);
    notify(r);r.listeners.clear();for(const fn of closedListeners)fn(r);
  }
  function get(id){const r=records.get(id);if(r&&now()>=r.expiresAt){close(id,'expired');return null;}return r??null;}
  function assert(owner,id){const r=get(id);if(!r)throw inlineError('request_unavailable','Inline request is no longer available. Start a new inline query.');
    if(r.botId!==owner.botId||r.agentId!==owner.agentId)throw inlineError('access_denied','Inline request belongs to another agent.');return r;}
  return {
    get,assert,
    current(botId,userId){const r=current.get(key(botId,userId));return r?get(r.requestId):null;},
    begin(input){const previous=current.get(key(input.botId,input.userId));if(previous)close(previous.requestId,'replaced');
      const rows=policy.promptRows??INLINE_POLICY.promptRows;
      const createdAt=now(),r={...input,requestId:randomUUID(),createdAt,expiresAt:createdAt+INLINE_POLICY.requestTtlMs,phase:'prompt',hasResults:false,inputDone:false,nextResult:0,promptPage:0,
        policy:Object.freeze({...INLINE_POLICY,...policy,promptRows:Array.isArray(rows)?Object.freeze([...rows]):rows}),listeners:new Set(),cursors:new Set()};
      records.set(r.requestId,r);current.set(key(r.botId,r.userId),r);return r;
    },
    issueCursor(id){const r=get(id);if(!r)throw inlineError('request_unavailable');const token=randomUUID().replaceAll('-','');
      cursors.set(token,{request:r,issuedAt:now()});r.cursors.add(token);return token;},
    resolveCursor({botId,userId,cursor}){const c=cursors.get(cursor);return c&&get(c.request.requestId)&&c.request.botId===botId&&c.request.userId===userId?c:null;},
    setReady(owner,id,prepared,done=true){const r=assert(owner,id);if(r.inputDone)return {status:'already_set'};
      if(typeof done!=='boolean')throw inlineError('invalid_argument','done must be boolean.');
      r.prepared??=[];for(const item of prepared)r.prepared.push(item);r.hasResults=true;r.inputDone=done;
      r.phase=r.nextResult<r.prepared.length||done?'ready':'waiting';
      if(prepared.length||done)notify(r);return {status:'accepted'};},
    subscribe(id,fn){const r=get(id);if(!r){fn();return ()=>{};}r.listeners.add(fn);return ()=>r.listeners.delete(fn);},
    onClose(fn){closedListeners.add(fn);return ()=>closedListeners.delete(fn);},
    delivered(id){const r=get(id);if(r){r.phase='delivered';delete r.prepared;delete r.query;notify(r);}},
    close,closeOwner(botId,agentId,reason){for(const r of [...records.values()])if(r.botId===botId&&r.agentId===agentId)close(r.requestId,reason);},
    closeAll(){for(const r of [...records.values()])close(r.requestId,'shutdown');}
  };
}
