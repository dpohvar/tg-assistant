import {randomUUID} from 'node:crypto';
import {permitsAllow} from '../messages/callbacks.mjs';
import {plainJSON} from '../widgets/contract.mjs';
import {inlineError} from './contract.mjs';
const TTL=30*86400000;
export function createInlineStore(db,{now=Date.now}={}) {
  const sql=db.sql;
  const owner=(botId,id)=>sql.prepare('SELECT * FROM inline_message_owners WHERE botId=? AND inlineMessageId=?').get(botId,id)??null;
  function conflict(agentId,view){return Object.assign(inlineError('inline_owner_conflict','This inline message belongs to another agent.'),{ownerAgentId:agentId,...(view?{widgetId:view.widgetId,viewId:view.viewId}:{})});}
  function assertOwner(scope,id,{allowUnknown=false}={}) {
    const known=owner(scope.botId,id),view=sql.prepare('SELECT * FROM widget_views WHERE botId=? AND inlineMessageId=?').get(scope.botId,id);
    if(view&&view.agentId!==scope.agentId)throw conflict(view.agentId,view);
    if(known&&known.agentId!==scope.agentId)throw conflict(known.agentId,view);
    if(!known&&!view&&!allowUnknown)throw inlineError('inline_message_unknown','This inline message has no known owner.');
    return known;
  }
  function claimOwner(scope,id){assertOwner(scope,id,{allowUnknown:true});sql.prepare('INSERT OR IGNORE INTO inline_message_owners VALUES(?,?,?,?,?)').run(scope.botId,id,scope.agentId,now(),now()+TTL);return owner(scope.botId,id);}
  function button(botId,btnId){const row=sql.prepare('SELECT * FROM inline_buttons WHERE botId=? AND btnId=? AND expiresAt>?').get(botId,btnId,now());
    if(!row)return null;if(row.btnGroup&&sql.prepare('SELECT 1 FROM inline_closed_groups WHERE botId=? AND tipId=? AND btnGroup=?').get(botId,row.tipId,row.btnGroup))return null;
    return {...row,group:row.btnGroup,permits:row.permits?JSON.parse(row.permits):null};}
  const event=row=>row?{...row,event:JSON.parse(row.payload)}:null;
  return {owner,assertOwner,claimOwner,button,
    registerPage(scope,page) {
      db.transaction(()=>{
        for(const result of page)for(const def of result.definitions??[]) {
          const closed=def.group&&sql.prepare('SELECT 1 FROM inline_closed_groups WHERE botId=? AND tipId=? AND btnGroup=?').get(scope.botId,def.tipId,def.group);
          if(closed){sql.prepare('UPDATE inline_closed_groups SET expiresAt=MAX(expiresAt,?) WHERE botId=? AND tipId=? AND btnGroup=?').run(now()+TTL,scope.botId,def.tipId,def.group);continue;}
          const existing=sql.prepare('SELECT * FROM inline_buttons WHERE botId=? AND btnId=?').get(scope.botId,def.btnId);
          if(existing){if(existing.agentId!==scope.agentId||existing.tipId!==def.tipId||existing.action!==def.action||existing.callbackKey!==def.callbackKey)throw inlineError('invalid_argument','Button identity cannot be reused for a different action.');continue;}
          sql.prepare('INSERT INTO inline_buttons VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(scope.botId,def.btnId,scope.agentId,def.tipId,def.key,def.group??null,def.callbackKey,def.permits==null?null:plainJSON(def.permits),def.action,def.component??'keyboard',now(),now()+TTL);
        }
      });return page.map(result=>result.native);
    },
    acceptButton({botId,callback,owner:scope}) {
      return db.transaction(()=>{
        const duplicate=event(sql.prepare('SELECT * FROM inline_button_events WHERE botId=? AND callbackId=?').get(botId,callback.id));
        if(duplicate)return {status:'duplicate',...duplicate};
        const btnId=/^i:([a-zA-Z0-9_-]+)$/.exec(callback.data??'')?.[1],def=btnId&&button(botId,btnId);
        if(!def||!callback.inline_message_id||!callback.from?.id||scope?.botId!==botId||scope.agentId!==def.agentId||!permitsAllow(def.permits,def.callbackKey,callback.from.id))return {status:'ignored'};
        claimOwner(scope,callback.inline_message_id);
        sql.prepare('UPDATE inline_message_owners SET expiresAt=MAX(expiresAt,?) WHERE botId=? AND inlineMessageId=?').run(now()+TTL,botId,callback.inline_message_id);
        if(def.group){
          const expiry=sql.prepare('SELECT MAX(expiresAt) expiresAt FROM inline_buttons WHERE botId=? AND tipId=? AND btnGroup=?').get(botId,def.tipId,def.group).expiresAt;
          sql.prepare('INSERT INTO inline_closed_groups VALUES(?,?,?,?)').run(botId,def.tipId,def.group,expiry);
          sql.prepare('DELETE FROM inline_buttons WHERE botId=? AND tipId=? AND btnGroup=?').run(botId,def.tipId,def.group);
        }
        const eventId=randomUUID(),accepted={eventType:'button',eventId,inlineMessageId:callback.inline_message_id,from:{userId:callback.from.id,name:[callback.from.first_name,callback.from.last_name].filter(Boolean).join(' '),...(callback.from.username?{username:callback.from.username}:{})},action:def.action,btnId,tipId:def.tipId,...(def.group?{btnGroup:def.group}:{})};
        sql.prepare('INSERT INTO inline_button_events(eventId,botId,agentId,callbackId,payload,component,createdAt) VALUES(?,?,?,?,?,?,?)').run(eventId,botId,def.agentId,callback.id,plainJSON(accepted),def.component??'keyboard',now());
        return {status:'accepted',eventId,event:accepted,botId,agentId:def.agentId,component:def.component??'keyboard'};
      });
    },
    pendingEvents(){return sql.prepare('SELECT * FROM inline_button_events WHERE queuedAt IS NULL AND discardedAt IS NULL ORDER BY createdAt,eventId').all().map(event);},
    callbackEvent(botId,id){return event(sql.prepare('SELECT * FROM inline_button_events WHERE botId=? AND callbackId=?').get(botId,id));},
    discardEvent(eventId){sql.prepare('UPDATE inline_button_events SET discardedAt=? WHERE eventId=? AND queuedAt IS NULL').run(now(),eventId);},
    markQueued(eventId){sql.prepare('UPDATE inline_button_events SET queuedAt=? WHERE eventId=? AND queuedAt IS NULL').run(now(),eventId);},
    saveConfirmed(scope,id,change) {
      assertOwner(scope,id);const checked=JSON.parse(plainJSON(change));
      db.transaction(()=>{
        const row=sql.prepare('SELECT content FROM inline_snapshots WHERE botId=? AND inlineMessageId=?').get(scope.botId,id),content=row?JSON.parse(row.content):{};
        const kinds=['text','rich_message','media','photo','video','animation','audio','document','voice','sticker','location','venue','contact'];
        const selected=kinds.find(kind=>checked[kind]!==undefined);
        if(selected){
          for(const kind of kinds)if(kind!==selected)delete content[kind];
          for(const field of ['entities','parse_mode','link_preview_options','caption','caption_entities','show_caption_above_media'])delete content[field];
        }else if(checked.caption!==undefined){delete content.caption_entities;delete content.parse_mode;}
        Object.assign(content,checked);
        sql.prepare('INSERT INTO inline_snapshots VALUES(?,?,?,?,?,0) ON CONFLICT(botId,inlineMessageId) DO UPDATE SET content=excluded.content,updatedAt=excluded.updatedAt,expiresAt=excluded.expiresAt,deliveryUnknown=0').run(scope.botId,id,plainJSON(content),now(),now()+TTL);
        sql.prepare('UPDATE inline_message_owners SET expiresAt=MAX(expiresAt,?) WHERE botId=? AND inlineMessageId=?').run(now()+TTL,scope.botId,id);
      });
    },
    markUnknown(scope,id) {assertOwner(scope,id);sql.prepare("INSERT INTO inline_snapshots(botId,inlineMessageId,expiresAt,deliveryUnknown) VALUES(?,?,?,1) ON CONFLICT(botId,inlineMessageId) DO UPDATE SET deliveryUnknown=1").run(scope.botId,id,owner(scope.botId,id).expiresAt);},
    read(scope,id) {
      const known=owner(scope.botId,id);if(!known)return null;assertOwner(scope,id);
      const row=sql.prepare('SELECT * FROM inline_snapshots WHERE botId=? AND inlineMessageId=?').get(scope.botId,id),view=sql.prepare('SELECT message,deliveryUnknown FROM widget_views WHERE botId=? AND inlineMessageId=?').get(scope.botId,id);
      if(view?.message){const content=JSON.parse(view.message);return {inlineMessageId:id,...content,snapshotComplete:true,deliveryUnknown:Boolean(view.deliveryUnknown)};}
      if(!row||row.expiresAt<=now()&&!view)return null;
      const content=JSON.parse(row.content),complete=['text','rich_message','media','photo','video','animation','audio','document','voice','sticker','location','venue','contact'].some(key=>content[key]!==undefined)&&content.reply_markup!==undefined;
      return {inlineMessageId:id,...content,snapshotComplete:complete,updatedAt:row.updatedAt,deliveryUnknown:Boolean(row.deliveryUnknown)};
    },
    cleanup(at=now()) {db.transaction(()=>{
      sql.prepare('DELETE FROM inline_buttons WHERE expiresAt<=?').run(at);
      sql.prepare('DELETE FROM inline_closed_groups WHERE expiresAt<=? AND NOT EXISTS(SELECT 1 FROM inline_buttons b WHERE b.botId=inline_closed_groups.botId AND b.tipId=inline_closed_groups.tipId AND b.btnGroup=inline_closed_groups.btnGroup)').run(at);
      sql.prepare('DELETE FROM inline_button_events WHERE (queuedAt IS NOT NULL OR discardedAt IS NOT NULL) AND createdAt<=?').run(at-TTL);
      sql.prepare('DELETE FROM inline_snapshots WHERE expiresAt<=? AND NOT EXISTS(SELECT 1 FROM widget_views v WHERE v.botId=inline_snapshots.botId AND v.inlineMessageId=inline_snapshots.inlineMessageId)').run(at);
      sql.prepare("DELETE FROM inline_message_owners WHERE expiresAt<=? AND NOT EXISTS(SELECT 1 FROM widget_views v WHERE v.botId=inline_message_owners.botId AND v.inlineMessageId=inline_message_owners.inlineMessageId) AND NOT EXISTS(SELECT 1 FROM inline_button_events e WHERE e.botId=inline_message_owners.botId AND json_extract(e.payload,'$.inlineMessageId')=inline_message_owners.inlineMessageId AND e.queuedAt IS NULL) AND NOT EXISTS(SELECT 1 FROM inline_snapshots s WHERE s.botId=inline_message_owners.botId AND s.inlineMessageId=inline_message_owners.inlineMessageId)").run(at);
    });},
  };
}
