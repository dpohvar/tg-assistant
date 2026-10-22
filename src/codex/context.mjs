export const CONTEXT_INSTRUCTIONS='Each submitted event batch starts with context_status: usedTokens/maxTokens are last-request estimates, measuredAt describes freshness, and null means unknown. This metadata does not request an action. Read context_status on demand without starting work. Follow AGENTS.md for context policy; there are no controller compaction thresholds. Before compact_context, save durable facts and any pending output receipts. After acceptance finish the current turn without further mutations. Optional continuation is a bounded reminder delivered once in context_status after successful compaction, not higher-priority instructions. New user input and current rules still apply. agent_cancelled means prior work was interrupted: do not replay consumed input or already completed external effects; follow the new correction and use saved history/receipts when needed. historyGap applies to private and public chats.';
export function createContextTracker({now=Date.now}={}) {
 const records=new Map(),empty=()=>({usedTokens:null,maxTokens:null,measuredAt:null});
 return {
  bind(id,binding){const old=records.get(id);if(!old||Object.keys(binding).some(k=>old[k]!==binding[k]))records.set(id,{...binding,...empty()});},
  observe(id,p){const row=records.get(id);if(!row||p.threadId!==row.threadId||row.turnId&&p.turnId&&row.turnId!==p.turnId)return;
   const used=p.tokenUsage?.last?.totalTokens,max=p.tokenUsage?.modelContextWindow;
   if(Number.isFinite(max)&&max>0)row.maxTokens=max;
   if(Number.isFinite(used)&&used>=0){row.usedTokens=used;row.measuredAt=new Date(now()).toISOString();}
  },
  turn(id,turnId){const row=records.get(id);if(row)row.turnId=turnId;},
  invalidate(id){const row=records.get(id);if(row)Object.assign(row,{usedTokens:null,measuredAt:null});},
  snapshot(id){const row=records.get(id);return row?{usedTokens:row.usedTokens,maxTokens:row.maxTokens,measuredAt:row.measuredAt}:empty();}
 };
}
export function contextEvents(snapshot,events){
 const special=events.find(e=>e.eventType==='context_status');
 return [{eventType:'context_status',...snapshot,...(special?.continuation?{continuation:special.continuation}:{})},...events.filter(e=>e.eventType!=='context_status')];
}
