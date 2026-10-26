import test from "node:test";
import assert from "node:assert/strict";
import {createWidgetAgentRequests} from "../../src/widgets/agent-requests.mjs";

const ref={botId:"b",agentId:"a",widgetId:"w",generation:3};
function fixture(){
  const events=[],removed=[];
  const requests=createWidgetAgentRequests({
    enqueue:(_ref,event)=>{events.push(structuredClone(event));return "accepted";},
    cancelQueued:(_ref,id)=>{removed.push(id);},
  });
  return {requests,events,removed};
}

test("request answers only the owning generation and validates JSON schema without settling on a bad result",async()=>{
  const x=fixture(),payload={text:"Hint",data:{attempts:["CRANE"]},
    responseSchema:{type:"object",properties:{hint:{type:"string"}},required:["hint"],additionalProperties:false}};
  const {requestId}=x.requests.begin(ref,payload,{timeoutMs:1000});
  payload.data.attempts.push("SLATE");
  assert.deepEqual(x.events[0].data,{attempts:["CRANE"]});
  const waiting=x.requests.wait(ref,requestId);
  assert.throws(()=>x.requests.answer({...ref,agentId:"other"},requestId,{hint:"A"}),/request_not_found/);
  assert.throws(()=>x.requests.answer(ref,requestId,{hint:5}),/invalid_response/);
  assert.deepEqual(x.requests.answer(ref,requestId,{hint:"Try a vowel"}),{status:"answered"});
  assert.deepEqual(await waiting,{hint:"Try a vowel"});
  assert.throws(()=>x.requests.answer(ref,requestId,{hint:"Again"}),/request_not_found/);
});

test("timeout and cancellation retract only queued requests",async()=>{
  const x=fixture();
  const first=x.requests.begin(ref,{text:"A"},{timeoutMs:10});
  await assert.rejects(x.requests.wait(ref,first.requestId),/request_timeout/);
  assert.deepEqual(x.removed,[first.requestId]);
  const second=x.requests.begin(ref,{text:"B"},{timeoutMs:1000});
  const waiting=x.requests.wait(ref,second.requestId);
  x.requests.cancel(ref,second.requestId);
  await assert.rejects(waiting,/request_cancelled/);
  assert.deepEqual(x.removed,[first.requestId,second.requestId]);
  assert.throws(()=>x.requests.begin(ref,{text:"bad",data:undefined},{timeoutMs:1000}),/invalid_argument/);
  assert.throws(()=>x.requests.begin(ref,{text:"bad",responseSchema:{$ref:"https://example.com/schema"}},{timeoutMs:1000}),/invalid_argument/);
});
