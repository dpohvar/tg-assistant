// Standalone, local, read-only inspection. No application imports or Telegram calls.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,16);
const identity=value=>/^\d+$/.test(String(value))?hash(value):null;
const errorCode=value=>value?JSON.parse(value)?.code??'unknown':null;

async function main(){
  const {values:v}=parseArgs({options:{db:{type:'string'},widget:{type:'string',multiple:true},'watch-seconds':{type:'string',default:'0'}}});
  if(!v.db||!v.widget?.length)throw new Error('Usage: node widget-callback-diagnostic.mjs --db PATH --widget ID [--widget ID] [--watch-seconds 120]');
  const seconds=Number(v['watch-seconds']);
  if(!Number.isSafeInteger(seconds)||seconds<0||seconds>300)throw new Error('watch-seconds must be an integer from 0 to 300.');
  const sql=new DatabaseSync(v.db,{readOnly:true,timeout:1000});
  try{
    sql.exec('PRAGMA query_only=ON');
    const schemaVersion=sql.prepare('SELECT MAX(version) version FROM schema_migrations').get().version;
    if(schemaVersion<15)throw new Error('This diagnostic requires widget views (schema 15 or later).');
    const widget=sql.prepare('SELECT widgetId,generation,status,handler,snapshotId,sequence,dropped,lastError,state FROM widgets WHERE widgetId=?');
    const events=sql.prepare('SELECT sum(started=0) pending,sum(started=1) running FROM widget_events WHERE widgetId=?');
    const views=sql.prepare('SELECT viewId,inlineMessageId,chatId,messageId,deliveryUnknown,buttonNames,lastError FROM widget_views WHERE widgetId=? ORDER BY viewId');
    function sample(){
      // One short read transaction per sample; never hold a reader across sleeps.
      sql.exec('BEGIN');
      try{
        const widgets=v.widget.map(id=>{
          const w=widget.get(id);if(!w)return {widgetId:id,missing:true};
          const {state:json,lastError,...metadata}=w,s=JSON.parse(json),q=events.get(id);
          return {...metadata,pending:q.pending??0,running:q.running??0,lastErrorCode:errorCode(lastError),stateHash:hash(json),
            state:{mode:['menu','game'].includes(s.mode)?s.mode:null,finished:typeof s.finished==='boolean'?s.finished:null,
              ownerHash:identity(s.ownerId),activePlayerHash:identity(s.activeId),playerCount:s.players&&typeof s.players==='object'?Object.keys(s.players).length:0},
            views:views.all(id).map(view=>{const names=JSON.parse(view.buttonNames);return {
              viewId:view.viewId,targetType:view.inlineMessageId?'inline':'ordinary',
              targetHash:hash(view.inlineMessageId??`${view.chatId}/${view.messageId}`),deliveryUnknown:Boolean(view.deliveryUnknown),
              buttonCount:names.length,hasMenuStart:names.includes('menu:start'),buttonsHash:hash(view.buttonNames),lastErrorCode:errorCode(view.lastError),
            };})};
        });
        sql.exec('COMMIT');return {access:'readOnly',schemaVersion,widgets};
      }catch(error){sql.exec('ROLLBACK');throw error;}
    }
    const abort=new AbortController(),stop=()=>abort.abort(),end=Date.now()+seconds*1000;
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
      let previous;
      do{
        const report=sample(),key=JSON.stringify(report);
        if(key!==previous){console.log(JSON.stringify({at:new Date().toISOString(),...report}));previous=key;}
        if(Date.now()>=end||abort.signal.aborted)break;
        try{await delay(Math.min(250,end-Date.now()),undefined,{signal:abort.signal});}catch(error){if(!abort.signal.aborted)throw error;}
      }while(!abort.signal.aborted);
    }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }finally{sql.close();}
}
main().catch(error=>{console.error(JSON.stringify({error:error.code??'diagnostic_failed',message:error.message}));process.exitCode=1;});
