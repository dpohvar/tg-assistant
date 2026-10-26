import test from "node:test";
import assert from "node:assert/strict";
import {createWidgetTransport,connectWidgetTransport} from "../../src/widgets/transport.mjs";

test("widget RPC preserves per-view publication details on action errors",async()=>{
  const server=await createWidgetTransport({handle:async()=>{}});
  let client;
  try{
    client=await connectWidgetTransport({...server.bootstrap,handle:async()=>{
      throw Object.assign(new Error("one view failed"),{code:"view_render_failed",
        updatedViews:[{viewId:"a",target:{chatId:1,messageId:1}}],
        failedViews:[{viewId:"b",error:{code:"MESSAGE_NOT_FOUND"}}]});
    }});
    await server.connected;
    await assert.rejects(server.request("dispatchAction",{}),error=>{
      assert.equal(error.code,"view_render_failed");
      assert.deepEqual(error.updatedViews.map(view=>view.viewId),["a"]);
      assert.deepEqual(error.failedViews.map(view=>view.viewId),["b"]);
      return true;
    });
  }finally{client?.close();await server.close();}
});
