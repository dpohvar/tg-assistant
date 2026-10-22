// Native control evidence is deliberately independent of the model work queue.
export function startTurn(rpc,params,{onIdentity=()=>{},timeout=600000}={}){
 return new Promise((resolve,reject)=>{
  const early=new Map();let id,finished=false;
  const cleanup=()=>{clearTimeout(timer);rpc.off('notification',observe);rpc.off('closed',closed);};
  const fail=e=>{if(finished)return;finished=true;cleanup();reject(e);};
  const accept=m=>{if(finished)return;finished=true;cleanup();resolve(m);};
  const closed=()=>fail(rpc.failure??Object.assign(new Error('Codex connection closed.'),{code:'codex_connection_failed'}));
  const observe=m=>{if(m.method!=='turn/completed'||m.params?.threadId!==params.threadId)return;if(id===m.params.turn.id)accept(m);else if(!id){early.set(m.params.turn.id,m);if(early.size>32)fail(Object.assign(new Error('Ambiguous turn completion.'),{code:'codex_protocol_error'}));}};
  const timer=setTimeout(()=>fail(Object.assign(new Error('Codex turn timed out.'),{code:'codex_event_timeout'})),timeout);
  rpc.on('notification',observe);rpc.on('closed',closed);
  Promise.resolve().then(()=>rpc.request('turn/start',params)).then(result=>{if(finished)return;id=result.turn.id;onIdentity(id);if(early.has(id))accept(early.get(id));}).catch(fail);
 });
}
export function compactThread(rpc,threadId,{onProgress=()=>{},timeout=120000}={}) {
  return new Promise(resolve=>{
    const identity={threadId};let itemDone=false,terminal,finished=false;
    const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);rpc.off('notification',observe);rpc.off('closed',closed);resolve({...result,identity:{...identity}});};
    const closed=()=>finish({state:'unknown',code:'connection_closed'});
    const observe=m=>{
      const p=m.params;if(p?.threadId!==threadId)return;
      try {
        if(m.method==='turn/started'&&!identity.turnId){identity.turnId=p.turn.id;onProgress({...identity});}
        if(p.item?.type==='contextCompaction'&&(!identity.turnId||p.turnId===identity.turnId)){
          identity.turnId??=p.turnId;identity.itemId=p.item.id;onProgress({...identity});
          if(m.method==='item/completed')itemDone=true;
        }
        if(m.method==='turn/completed'&&p.turn.id===identity.turnId)terminal=p.turn.status;
        if(terminal&&terminal!=='completed')finish({state:['interrupted','failed'].includes(terminal)?terminal:'unknown'});
        else if(terminal==='completed'&&itemDone)finish({state:'completed'});
      }catch{finish({state:'unknown',code:'evidence_persistence_failed'});}
    };
    const timer=setTimeout(()=>finish({state:'unknown',code:'compact_timeout'}),timeout);
    rpc.on('notification',observe);rpc.on('closed',closed);
    Promise.resolve().then(()=>rpc.request('thread/compact/start',{threadId})).catch(error=>finish({state:error.code==='codex_rpc_rejected'&&!identity.turnId?'failed':'unknown',code:error.code??'compact_failed'}));
  });
}
export async function reconcileControl(rpc,record) {
  if(!record.threadId||!record.turnId)return {state:'unknown'};
  try {
    const {thread}=await rpc.request('thread/read',{threadId:record.threadId,includeTurns:true});
    const turn=thread.turns?.find(t=>t.id===record.turnId);
    if(!turn)return {state:'unknown'};
    if(record.itemId&&!turn.items?.some(i=>i.id===record.itemId&&i.type==='contextCompaction'))return {state:'unknown'};
    return {state:['completed','interrupted','failed'].includes(turn.status)?turn.status:'unknown',identity:{threadId:record.threadId,turnId:turn.id,...(record.itemId?{itemId:record.itemId}:{})}};
  }catch{return {state:'unknown'};}
}
