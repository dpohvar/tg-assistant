import test from "node:test";
import assert from "node:assert/strict";
import {WIDGET_TOOL_SCHEMAS} from "../../src/widgets/contract.mjs";
import {WIDGET_API_METHODS} from "../../src/widgets/api.mjs";

test("agent widget tools expose React components and store updates, not legacy hooks",()=>{
  assert.ok(WIDGET_TOOL_SCHEMAS.create_widget.properties.props);
  assert.equal(WIDGET_TOOL_SCHEMAS.create_widget.properties.state,undefined);
  assert.ok(WIDGET_TOOL_SCHEMAS.set_widget_view.properties.component);
  assert.ok(WIDGET_TOOL_SCHEMAS.set_widget_view.properties.viewId);
  assert.ok(WIDGET_TOOL_SCHEMAS.update_widget_store.properties.state);
  assert.equal(WIDGET_TOOL_SCHEMAS.widget_event,undefined);
});

test("Runtime WebSocket capabilities use the same scoped agent API",()=>{
  for(const method of ["ws_open","ws_list","ws_pull","ws_send","ws_close","ws_delete"])
    assert.ok(WIDGET_API_METHODS.has(method),method);
});
