import {randomUUID} from 'node:crypto';
import {inlineError} from './contract.mjs';
const neutral=title=>({type:'article',id:randomUUID(),title,input_message_content:{message_text:'✖️'}});
export function createInlineService({requests,clock={now:Date.now,setTimeout,clearTimeout},resolveActor,getPromptPhoto=()=>null,enqueue,cancelPending=()=>{},normalizeResults,registerPage,answer,observe=()=>{}}){
  const jobs=new Set(),seen=new Map(),expiry=new Map();let closed=false;
  const observation=event=>{try{observe(event);}catch{ /* Telemetry never changes protocol. */ }};
  const stopped=requests.onClose(r=>{clock.clearTimeout(expiry.get(r.requestId));expiry.delete(r.requestId);cancelPending(r.requestId);
    observation({type:'closed',requestId:r.requestId,reason:r.reason,at:clock.now()});});
  const live=r=>r&&requests.get(r.requestId)===r;
  const prompt=r=>{
    const time=new Date(clock.now()).toISOString().slice(11,19);
    const rows=r.policy.promptRows,page=r.promptPage++,count=Array.isArray(rows)?rows[Math.min(page,rows.length-1)]:rows;
    return Array.from({length:count},()=>neutral(`⬇️ Scroll to send command [${time}]`));
  };
  function authorized(r){if(!live(r))return false;const owner=resolveActor(r.botId,r.userId);
    if(!owner||owner.agentId!==r.agentId){requests.close(r.requestId,'agent_unavailable');return false;}return true;}
  async function wait(r){
    if(!live(r)||r.phase!=='waiting')return;
    await new Promise(resolve=>{
      let done=false,timer,unsubscribe=()=>{};
      const finish=()=>{if(done)return;done=true;clock.clearTimeout(timer);unsubscribe();resolve();};
      timer=clock.setTimeout(finish,Math.max(0,Math.min(r.policy.waitMs,r.expiresAt-clock.now())));
      unsubscribe=requests.subscribe(r.requestId,finish);
      if(!live(r)||r.phase!=='waiting')finish();
    });
  }
  async function send(botId,q,r,results,more=false,button){
    // Recheck after registry/async work, then issue exactly this cursor immediately before send.
    if(r&&!authorized(r)){results=[];more=false;}
    const offset=more?requests.issueCursor(r.requestId):'';
    const body={inline_query_id:q.id,results,next_offset:offset,cache_time:0,is_personal:true,...(button?{button}:{})};
    observation({type:'answer_started',queryId:q.id,requestId:r?.requestId,at:clock.now(),rows:results.length,resultKinds:results.map(x=>x.type)});
    try{await answer(botId,body);observation({type:'answer_finished',queryId:q.id,requestId:r?.requestId,at:clock.now()});}
    catch(e){if(r)requests.close(r.requestId,'answer_failed');observation({type:'answer_failed',queryId:q.id,requestId:r?.requestId,at:clock.now(),code:e.code??'answer_failed'});return false;}
    return true;
  }
  async function page(botId,q,receivedAt){
    let r;
    if(!q.offset){
      const old=requests.current(botId,q.from.id);if(old)requests.close(old.requestId,'replaced');
      const actor=resolveActor(botId,q.from.id);
      if(!actor)return send(botId,q,null,[],false,{text:'Open bot',start_parameter:'inline'});
      r=requests.begin({botId,userId:q.from.id,agentId:actor.agentId,query:q.query,...(q.chat_type?{chatType:q.chat_type}:{})});
      const timer=clock.setTimeout(()=>requests.close(r.requestId,'expired'),Math.max(0,r.expiresAt-clock.now()));timer?.unref?.();expiry.set(r.requestId,timer);
      const results=prompt(r);let photo;
      try{photo=await getPromptPhoto(botId);}catch{ /* A missing profile preview preserves the ordinary drum. */ }
      if(typeof photo==='string'&&photo)results[0]={...results[0],type:'photo',photo_file_id:photo};
      return send(botId,q,r,results,true);
    }
    const cursor=requests.resolveCursor({botId,userId:q.from.id,cursor:q.offset});r=cursor?.request;
    if(!r||!authorized(r))return send(botId,q,null,[]);
    observation({type:'page_received',queryId:q.id,requestId:r.requestId,receivedAt,issuedAt:cursor.issuedAt,phase:r.phase});
    if(r.phase==='delivered')return send(botId,q,r,[]);
    if(r.phase==='prompt'){
      if(receivedAt-cursor.issuedAt<r.policy.triggerMs)
        return send(botId,q,r,prompt(r),true);
      const actor=resolveActor(botId,r.userId);r.phase='waiting';
      const event={eventType:'inline',requestId:r.requestId,query:r.query,...(r.chatType?{chatType:r.chatType}:{}),expiresAt:new Date(r.expiresAt).toISOString()};
      const result=enqueue(actor,event,()=>authorized(r));
      if(result!=='accepted'){requests.close(r.requestId,'queue_unavailable');return send(botId,q,null,[]);}
      observation({type:'triggered',queryId:q.id,requestId:r.requestId,at:clock.now()});
      return send(botId,q,r,[neutral('⬇️ Command sent to agent')],true);
    }
    await wait(r);
    if(!authorized(r))return send(botId,q,null,[]);
    if(r.phase==='waiting')return send(botId,q,r,[neutral('⬇️ Agent is working')],true);
    if(r.phase==='delivered')return send(botId,q,r,[]);
    const prepared=r.prepared?.length?r.prepared:[{native:neutral('Work complete')}];
    const start=r.nextResult,candidate=prepared.slice(start,start+r.policy.pageSize);
    // Normalization puts photos last; begin that group on its own page for client compatibility.
    const firstPhoto=candidate.findIndex(item=>item.native.type==='photo');
    const part=firstPhoto>0?candidate.slice(0,firstPhoto):candidate;
    if(!part.length)return send(botId,q,r,[]);
    r.nextResult+=part.length;const more=r.nextResult<prepared.length;
    let results;
    try{if(!authorized(r))return send(botId,q,null,[]);results=await registerPage({botId:r.botId,agentId:r.agentId,chatId:r.userId},part);}
    catch(e){requests.close(r.requestId,'registration_failed');observation({type:'registration_failed',requestId:r.requestId,code:e.code??'storage_failed'});return;}
    const ok=await send(botId,q,r,results,more);
    if(ok&&!more&&live(r))requests.delivered(r.requestId);
  }
  return {
    receive(botId,q){
      if(closed||!q?.id||!q.from?.id||typeof q.query!=='string')return;
      const receivedAt=clock.now();for(const [key,until]of seen)if(until<=receivedAt)seen.delete(key);
      const key=JSON.stringify([botId,q.id]);if(seen.has(key))return;seen.set(key,receivedAt+3600000);
      const job=page(botId,q,receivedAt).catch(e=>{const c=q.offset&&requests.resolveCursor({botId,userId:q.from.id,cursor:q.offset});if(c)requests.close(c.request.requestId,'page_failed');observation({type:'page_failed',queryId:q.id,code:e.code??'inline_failed'});});
      jobs.add(job);job.finally(()=>jobs.delete(job));
    },
    setResults(scope,{requestId,results}){const r=requests.assert(scope,requestId);if(!authorized(r))throw inlineError('request_unavailable');
      if(r.hasResults)return {status:'already_set'};const prepared=normalizeResults(scope,results);return requests.setReady(scope,requestId,prepared);},
    disableOwner(botId,agentId,reason='agent_disabled'){requests.closeOwner(botId,agentId,reason);},
    close(){if(closed)return;closed=true;requests.closeAll();stopped();seen.clear();},
    async idle(){while(jobs.size)await Promise.allSettled([...jobs]);}
  };
}
