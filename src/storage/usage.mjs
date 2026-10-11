export const tokenFields=['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','cacheWriteInputTokens','totalTokens'];
export const usageFields=[...tokenFields,'imageGenerations','imageBytes'];
export const zeroUsage=()=>Object.fromEntries(usageFields.map(k=>[k,0]));
export function usageSlots(now){const s=new Date(now).toISOString();return {total:'',year:s.slice(0,4),month:s.slice(0,7),day:s.slice(0,10),hour:s.slice(0,13)};}
function cutoffs(now){const d=new Date(now),month=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-11,1));return {month:month.toISOString().slice(0,7),day:new Date(now-29*86400000).toISOString().slice(0,10),hour:new Date(now-23*3600000).toISOString().slice(0,13)};}
function normalize(value){const row={};for(const k of tokenFields){const n=value[k]??(k==='cacheWriteInputTokens'?0:undefined);if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid usage counter');row[k]=n;}if(row.cachedInputTokens>row.inputTokens||row.reasoningOutputTokens>row.outputTokens)throw new Error('Invalid usage categories');return row;}
export function createUsageStore(db){
 const sql=db.sql;
 function sync(now=Date.now()){
  sql.prepare('INSERT INTO usage_bots SELECT telegramId,username,? FROM bots WHERE true ON CONFLICT(telegramId) DO UPDATE SET username=excluded.username').run(now);
 }
 function trim(now,id){for(const[k,cut]of Object.entries(cutoffs(now)))sql.prepare('DELETE FROM usage_buckets WHERE kind=? AND slot<?'+(id===undefined?'':' AND telegramId=?')).run(...[k,cut,...(id===undefined?[]:[id])]);}
 function add(id,delta,now){
  for(const[k,v]of Object.entries(delta))if(!usageFields.includes(k)||!Number.isSafeInteger(v)||v<0)throw new Error('Invalid usage delta');
  if(!Object.values(delta).some(Boolean))return;
  for(const[kind,slot]of Object.entries(usageSlots(now))){const existing=sql.prepare('SELECT counters FROM usage_buckets WHERE telegramId=? AND kind=? AND slot=?').get(id,kind,slot);const total=existing?JSON.parse(existing.counters):zeroUsage();for(const[k,v]of Object.entries(delta)){total[k]+=v;if(!Number.isSafeInteger(total[k]))throw new Error('Usage counter overflow');}sql.prepare('INSERT INTO usage_buckets VALUES(?,?,?,?) ON CONFLICT(telegramId,kind,slot) DO UPDATE SET counters=excluded.counters').run(id,kind,slot,JSON.stringify(total));}
  trim(now,id);
 }
 return {
  sync,
  track(botId,agentId,threadId,{seed=false,rootThreadId=threadId,now=Date.now()}={}){
   const bot=db.getBot(botId);if(!bot)return;sync(now);
   const previous=sql.prepare('SELECT telegramId,agentId FROM usage_threads WHERE threadId=?').get(threadId);if(previous&&(previous.telegramId!==bot.telegramId||previous.agentId!==agentId))throw new Error('Usage thread ownership mismatch');
   sql.prepare('INSERT OR IGNORE INTO usage_threads(threadId,telegramId,agentId,rootThreadId,seed,seenAt) VALUES(?,?,?,?,?,?)').run(threadId,bot.telegramId,agentId,rootThreadId,Number(seed),now);
   sql.prepare('UPDATE usage_threads SET finishedAt=NULL,seenAt=? WHERE threadId=?').run(now,threadId);
  },
  tokens(threadId,value,now=Date.now(),{turnId,allowReset=false}={}){
   const next=normalize(value);
   return db.transaction(()=>{
    const row=sql.prepare('SELECT * FROM usage_threads WHERE threadId=?').get(threadId);if(!row)return;
    const prev=row.counters?JSON.parse(row.counters):Object.fromEntries(tokenFields.map(k=>[k,0]));
    const reset=tokenFields.some(k=>next[k]<prev[k]);if(reset&&!(allowReset&&turnId&&turnId!==row.turnId))return {reset:true};const delta={};for(const k of tokenFields)delta[k]=row.seed||reset?0:next[k]-prev[k];
    add(row.telegramId,delta,now);sql.prepare('UPDATE usage_threads SET counters=?,seed=0,seenAt=?,turnId=COALESCE(?,turnId) WHERE threadId=?').run(JSON.stringify(next),now,turnId??null,threadId);return {reset,rebased:reset};
   });
  },
  image(threadId,itemId,state,bytes=0,now=Date.now()){
   if(!['started','completed'].includes(state)||!Number.isSafeInteger(bytes)||bytes<0)throw new Error('Invalid image accounting');
   db.transaction(()=>{const thread=sql.prepare('SELECT * FROM usage_threads WHERE threadId=?').get(threadId);if(!thread)return;
    const image=sql.prepare('SELECT * FROM usage_images WHERE threadId=? AND itemId=?').get(threadId,itemId)??{started:0,completed:0};
    const delta={};if(state==='started'&&!image.started){delta.imageGenerations=1;image.started=1;}if(state==='completed'&&!image.completed){delta.imageBytes=bytes;image.completed=1;}
    add(thread.telegramId,delta,now);sql.prepare('INSERT INTO usage_images VALUES(?,?,?,?,?) ON CONFLICT(threadId,itemId) DO UPDATE SET started=excluded.started,completed=excluded.completed,seenAt=excluded.seenAt').run(threadId,itemId,image.started,image.completed,now);sql.prepare('UPDATE usage_threads SET seenAt=? WHERE threadId=?').run(now,threadId);
   });
  },
  finish(threadId,now=Date.now()){sql.prepare('UPDATE usage_threads SET finishedAt=?,seenAt=? WHERE threadId=?').run(now,now,threadId);},
  forget(rootThreadId){sql.prepare('DELETE FROM usage_threads WHERE rootThreadId=?').run(rootThreadId);},
  list(){sync();return sql.prepare('SELECT u.*,NOT EXISTS(SELECT 1 FROM bots b WHERE b.telegramId=u.telegramId) AS removed FROM usage_bots u').all().map(r=>({...r,removed:!!r.removed,total:JSON.parse(sql.prepare("SELECT counters FROM usage_buckets WHERE telegramId=? AND kind='total'").get(r.telegramId)?.counters??JSON.stringify(zeroUsage()))}));},
  periods(id,option,now=Date.now()){
   const kind={hours:'hour',days:'day',months:'month',years:'year'}[option];if(!kind)throw new Error('Invalid usage period');const cut=cutoffs(now)[kind]??'';
   return sql.prepare('SELECT slot,counters FROM usage_buckets WHERE telegramId=? AND kind=? AND slot>=? ORDER BY slot DESC').all(id,kind,cut).map(r=>({...r,counters:JSON.parse(r.counters),inProgress:r.slot===usageSlots(now)[kind]}));
  },
  startedAt(){return Number(sql.prepare("SELECT value FROM controller_state WHERE key='usage_started_at'").get().value);},
  cleanup(now=Date.now()){
   trim(now);
   sql.prepare('DELETE FROM usage_images WHERE seenAt<?').run(now-7*86400000);
   // Finished child dedup records are kept seven days; active/saved root baselines survive idle periods.
   sql.prepare('DELETE FROM usage_threads WHERE threadId!=rootThreadId AND finishedAt<? AND seenAt<?').run(now-7*86400000,now-7*86400000);
   sql.prepare('DELETE FROM usage_threads WHERE rootThreadId NOT IN (SELECT threadId FROM agents WHERE threadId IS NOT NULL) AND seenAt<?').run(now-7*86400000);
  }
 };
}
