import {createInlineService} from '../../src/inline/service.mjs';
import {createInlineRequests} from '../../src/inline/requests.mjs';
export async function tick(){for(let i=0;i<20;i++)await Promise.resolve();}
export function fakeClock(){
  let time=0,sequence=0; const timers=new Map();
  return {now:()=>time,setTimeout(fn,ms){const id=++sequence;timers.set(id,{at:time+ms,fn});return id;},clearTimeout(id){timers.delete(id);},
    async advance(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await tick();}time=end;await tick();},pending:()=>timers.size};
}
export function inlineFixture(t,options={}){
  const clock=fakeClock(),answers=[],queued=[],registered=[],cancelled=[],observations=[];
  const requests=createInlineRequests({now:clock.now,policy:{promptRows:2,...options.policy}});
  let queryId=0,answerFailure=null,registrationFailure=null,normalizeCalls=0;
  const scope={botId:'b',agentId:'a',chatId:1};
  const service=createInlineService({requests,clock,
    getPromptPhoto:options.getPromptPhoto,
    resolveActor:options.resolveActor??(()=>({...scope,userId:1})),
    enqueue:(owner,event,admit)=>{queued.push({owner,event,admit});return 'accepted';},
    cancelPending:id=>cancelled.push(id),
    normalizeResults:(_owner,results)=>{normalizeCalls++;if(options.normalizeResults)return options.normalizeResults(_owner,results);if(!Array.isArray(results)||results.some(x=>!x.title))throw Object.assign(new Error('Invalid result'),{code:'invalid_argument'});return results.map(x=>({native:{type:'article',id:x.id??'result-'+normalizeCalls,title:x.title,input_message_content:{message_text:x.message?.text??'✖️'}},status:x.message===undefined}));},
    registerPage:async(owner,page)=>{if(registrationFailure)throw registrationFailure;registered.push(page);await options.registerPage?.(owner,page);return page.map(x=>x.native);},
    answer:async(botId,body)=>{if(answerFailure)throw answerFailure;await options.answer?.(body);answers.push(body);return true;},
    observe:event=>observations.push(event)});
  t.after(()=>service.close());
  return {clock,service,requests,scope,answers,queued,registered,cancelled,observations,
    normalizeCalls:()=>normalizeCalls,
    failAnswer:error=>{answerFailure=error;},failRegistration:error=>{registrationFailure=error;},
    async query({offset='',query='wordle',id=String(++queryId),userId=1,botId='b',chatType}={}){
      service.receive(botId,{id,from:{id:userId},query,offset,...(chatType?{chat_type:chatType}:{})});await tick();return answers.findLast(a=>a.inline_query_id===id);
    }};
}
