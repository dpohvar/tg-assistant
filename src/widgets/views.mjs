import {randomUUID} from 'node:crypto';
import {plainJSON,widgetError} from './contract.mjs';
export function widgetTarget(target){
  if(!target||typeof target!=='object'||Array.isArray(target))throw widgetError('invalid_argument','A message target is required.');
  const keys=Object.keys(target);
  if(keys.length===1&&typeof target.inlineMessageId==='string'&&target.inlineMessageId.length)return {inlineMessageId:target.inlineMessageId};
  if(keys.length===2&&Number.isSafeInteger(target.chatId)&&target.chatId!==0&&Number.isSafeInteger(target.messageId)&&target.messageId>0)
    return {chatId:target.chatId,messageId:target.messageId};
  throw widgetError('invalid_argument','Use either inlineMessageId or chatId/messageId.');
}
export function viewSnapshot(v){return {id:v.id,target:structuredClone(v.target),props:structuredClone(v.props)};}
export function deepFreeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))deepFreeze(item);Object.freeze(value);}return value;}
export function createWidgetViews({db,widgets}){
  const sql=db.sql;
  const jsonFields=new Set(['props','message','renderSpec','buttonNames','lastError']);
  function decode(row){if(!row)return null;const view={...row,id:row.viewId,target:row.inlineMessageId?{inlineMessageId:row.inlineMessageId}:{chatId:row.chatId,messageId:row.messageId},deliveryUnknown:Boolean(row.deliveryUnknown)};
    for(const field of jsonFields)view[field]=row[field]===null?null:JSON.parse(row[field]);return view;}
  function getView(id){return decode(sql.prepare('SELECT * FROM widget_views WHERE viewId=?').get(id));}
  function byTarget(botId,value){const target=widgetTarget(value);return decode(target.inlineMessageId?
    sql.prepare('SELECT * FROM widget_views WHERE botId=? AND inlineMessageId=?').get(botId,target.inlineMessageId):
    sql.prepare('SELECT * FROM widget_views WHERE botId=? AND chatId=? AND messageId=?').get(botId,target.chatId,target.messageId));}
  function owned(ref,id){widgets.current(ref);const v=getView(id);if(!v||v.widgetId!==ref.widgetId)throw widgetError('view_not_found');return v;}
  function createView(ref,input){const w=widgets.current(ref),target=widgetTarget(input.target),props=plainJSON(input.props??{});
    const conflict=byTarget(w.botId,target);if(conflict)throw Object.assign(widgetError('view_conflict','This message already belongs to a widget view.'),
      {ownerAgentId:conflict.agentId,widgetId:conflict.widgetId,viewId:conflict.id});
    const id=input.id??'v'+randomUUID().replaceAll('-','');
    sql.prepare(`INSERT INTO widget_views(viewId,widgetId,botId,agentId,chatId,messageId,inlineMessageId,chatType,topicId,props,bindingEpoch,message,renderHash,renderSpec,buttonNames,pollId,lastError,deliveryUnknown)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,w.widgetId,w.botId,w.agentId,target.chatId??null,target.messageId??null,target.inlineMessageId??null,input.chatType??null,input.topicId??null,props,input.bindingEpoch??randomUUID(),
        input.message?plainJSON(input.message):null,input.renderHash??null,input.renderSpec?plainJSON(input.renderSpec):null,plainJSON(input.buttonNames??[]),input.pollId??null,input.lastError?plainJSON(input.lastError):null,+Boolean(input.deliveryUnknown));
    return getView(id);
  }
  return {getView,byTarget,createView,
    listViews(widgetId){return sql.prepare('SELECT * FROM widget_views WHERE widgetId=? ORDER BY rowid').all(widgetId).map(decode);},
    patchView(ref,id,fields){owned(ref,id);const allowed=new Set([...jsonFields,'renderHash','pollId','deliveryUnknown','chatType','topicId']);
      if(Object.keys(fields).some(key=>!allowed.has(key)))throw widgetError('invalid_argument');const keys=Object.keys(fields);if(!keys.length)return getView(id);
      const values=keys.map(key=>fields[key]===null?null:jsonFields.has(key)?plainJSON(fields[key]):key==='deliveryUnknown'?+Boolean(fields[key]):fields[key]);
      sql.prepare(`UPDATE widget_views SET ${keys.map(key=>key+'=?').join(',')} WHERE viewId=?`).run(...values,id);return getView(id);},
    replaceView(ref,id,input){return db.transaction(()=>{const old=owned(ref,id),target=widgetTarget(input.target??old.target);
      if(JSON.stringify(target)!==JSON.stringify(old.target))throw widgetError('invalid_argument','A replacement keeps the same message address.');
      sql.prepare('DELETE FROM widget_views WHERE viewId=?').run(id);
      const next=createView(ref,{...input,target,bindingEpoch:old.bindingEpoch});
      if(old.pollId&&old.pollId!==next.pollId)sql.prepare('DELETE FROM widget_poll_answers WHERE widgetId=? AND pollId=?').run(ref.widgetId,old.pollId);
      return next;});},
    detachView(ref,id){return db.transaction(()=>{const v=owned(ref,id);sql.prepare('DELETE FROM widget_views WHERE viewId=?').run(id);
      if(v.pollId)sql.prepare('DELETE FROM widget_poll_answers WHERE widgetId=? AND pollId=?').run(ref.widgetId,v.pollId);return v;});},
    byMessage(botId,chatId,messageId){const v=byTarget(botId,{chatId,messageId});return v?{...widgets.get(v.widgetId),view:v}:null;},
    byPoll(botId,pollId){const v=decode(sql.prepare('SELECT * FROM widget_views WHERE botId=? AND pollId=? LIMIT 1').get(botId,pollId));return v?{...widgets.get(v.widgetId),view:v}:null;},
    addCandidate(ref,{viewId='v'+randomUUID().replaceAll('-',''),target,createdAt=Date.now(),reason='delivery_unknown'}){widgets.current(ref);
      if(!target||typeof target!=='object'||Array.isArray(target))throw widgetError('invalid_argument');
      const ordinary=Number.isSafeInteger(target.chatId)&&target.chatId!==0&&Object.keys(target).every(k=>['chatId','messageId'].includes(k))&&(target.messageId===undefined||Number.isSafeInteger(target.messageId)&&target.messageId>0);
      const opaque=Object.keys(target).length===1&&['inlineMessageId','guestRequestId'].some(key=>typeof target[key]==='string'&&target[key]);
      if(!ordinary&&!opaque)throw widgetError('invalid_argument','A publication candidate needs an ordinary, inline or pending guest address.');
      sql.prepare('INSERT OR REPLACE INTO widget_publication_candidates(viewId,widgetId,botId,agentId,chatId,messageId,createdAt,reason,inlineMessageId,guestRequestId) VALUES(?,?,?,?,?,?,?,?,?,?)').run(viewId,ref.widgetId,ref.botId,ref.agentId,target.chatId??null,target.messageId??null,createdAt,reason,target.inlineMessageId??null,target.guestRequestId??null);return viewId;},
    listCandidates(widgetId){return sql.prepare('SELECT * FROM widget_publication_candidates WHERE widgetId=? ORDER BY createdAt,viewId').all(widgetId).map(row=>({viewId:row.viewId,target:row.inlineMessageId?{inlineMessageId:row.inlineMessageId}:row.guestRequestId?{guestRequestId:row.guestRequestId}:{chatId:row.chatId,...(row.messageId?{messageId:row.messageId}:{})},createdAt:row.createdAt,reason:row.reason}));},
    getCandidate(viewId){return sql.prepare('SELECT * FROM widget_publication_candidates WHERE viewId=?').get(viewId)??null;},
    removeCandidate(ref,viewId){widgets.current(ref);sql.prepare('DELETE FROM widget_publication_candidates WHERE widgetId=? AND viewId=?').run(ref.widgetId,viewId);}
  };
}
