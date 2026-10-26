import {randomUUID} from "node:crypto";
import Ajv from "ajv";
import {plainJSON,validateAgentRequestPayload,widgetError} from "./contract.mjs";

const ajv=new Ajv({strict:true,allErrors:true,removeAdditional:false,useDefaults:false,coerceTypes:false});
const sameRef=(a,b)=>a.botId===b.botId&&a.agentId===b.agentId&&
  a.widgetId===b.widgetId&&a.generation===b.generation;

export function createWidgetAgentRequests({enqueue,cancelQueued=()=>{},isCurrent=()=>true,clock=Date.now}){
  const pending=new Map();
  function entry(ref,requestId){
    const item=pending.get(requestId);
    if(!item||!sameRef(item.ref,ref))throw widgetError("request_not_found");
    return item;
  }
  function settle(item,error,result){
    if(item.settled)return false;
    item.settled=true;clearTimeout(item.timer);
    if(error){cancelQueued(item.ref,item.requestId);item.reject(error);}
    else item.resolve(result);
    return true;
  }
  function schemaFor(schema){
    if(schema===undefined)return null;
    if(!schema||typeof schema!=="object"||Array.isArray(schema))
      throw widgetError("invalid_argument","responseSchema must be a JSON Schema object.");
    const visit=value=>{
      if(!value||typeof value!=="object")return;
      if(typeof value.$ref==="string"&&!value.$ref.startsWith("#"))
        throw widgetError("invalid_argument","Only local JSON Schema references are supported.");
      for(const child of Object.values(value))visit(child);
    };
    visit(schema);
    try{return ajv.compile(schema);}catch(error){throw widgetError("invalid_argument",`Invalid responseSchema: ${error.message}`);}
  }
  return {
    begin(ref,input,{timeoutMs,hasSignal=false}={}){
      const payload=validateAgentRequestPayload(input);
      if((timeoutMs===undefined&&!hasSignal)||
          (timeoutMs!==undefined&&(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>24*60*60*1000)))
        throw widgetError("invalid_argument","Provide timeoutMs or an AbortSignal.");
      if(pending.size>=1000)throw widgetError("runtime_quota","Too many pending widget requests.");
      const validate=schemaFor(payload.responseSchema),requestId=randomUUID(),
        expiresAt=timeoutMs===undefined?undefined:clock()+timeoutMs;
      let resolve,reject;
      const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      promise.catch(()=>{});
      const item={ref:{...ref},requestId,promise,resolve,reject,validate,settled:false,timer:null};
      pending.set(requestId,item);
      const event={eventType:"widget_request",widgetId:ref.widgetId,requestId,
        text:payload.text,...(Object.hasOwn(payload,"data")?{data:payload.data}:{}),
        ...(payload.responseSchema?{responseSchema:payload.responseSchema}:{}),
        ...(expiresAt===undefined?{}:{expiresAt})};
      try{
        if(enqueue(ref,event)!=="accepted")throw widgetError("agent_unavailable","Owner queue did not accept the request.");
      }catch(error){pending.delete(requestId);throw error;}
      if(timeoutMs!==undefined)item.timer=setTimeout(()=>settle(item,widgetError("request_timeout")),timeoutMs);
      return {requestId,expiresAt};
    },
    async wait(ref,requestId){
      const item=entry(ref,requestId);
      try{return await item.promise;}finally{pending.delete(requestId);}
    },
    answer(scope,requestId,result){
      const item=pending.get(requestId);
      if(!item||item.settled||item.ref.botId!==scope.botId||item.ref.agentId!==scope.agentId||
          !isCurrent(item.ref))throw widgetError("request_not_found","Request expired, cancelled or belongs to another owner.");
      const snapshot=JSON.parse(plainJSON(result));
      if(item.validate&&!item.validate(snapshot)){
        const details=item.validate.errors?.map(error=>`${error.instancePath||"/"} ${error.message}`).join("; ")??"Invalid response";
        throw widgetError("invalid_response",details);
      }
      settle(item,null,snapshot);
      return {status:"answered"};
    },
    cancel(ref,requestId,reason="request_cancelled"){
      const item=entry(ref,requestId);
      settle(item,widgetError(reason));
    },
    cancelWidget(ref,reason="request_cancelled"){
      for(const item of pending.values())if(sameRef(item.ref,ref))settle(item,widgetError(reason));
    },
    cancelOwner(owner,reason="request_cancelled"){
      for(const item of pending.values())if(item.ref.botId===owner.botId&&item.ref.agentId===owner.agentId)
        settle(item,widgetError(reason));
    },
    close(){for(const item of pending.values())settle(item,widgetError("request_cancelled"));pending.clear();},
    size(){return pending.size;},
  };
}
