import test from "node:test";
import assert from "node:assert/strict";
import { RpcProcess } from "../../src/codex/rpc.mjs";
import { agentFailureDiagnostic } from "../../src/codex/diagnostics.mjs";

test('unknown configuration fields classify without exposing private paths or values',()=>{
 const e=Object.assign(new Error('Codex MCP configuration could not be isolated.'),{code:'mcp_config_failed',diagnostic:{stage:'mcp_preflight'},cause:Object.assign(new Error('Codex process exited.'),{diagnostic:{exitCode:1,stderr:'Error: /PRIVATE_PATH/config.toml:3:1: unknown configuration field `tui.daemon_auto_start`\nPRIVATE_TOKEN'}})});
 assert.deepEqual(agentFailureDiagnostic(e),{code:'mcp_config_failed',stage:'mcp_preflight',exitCode:1,reason:'invalid_configuration'});
});

test('malformed RPC and event timeouts have safe machine failure codes',async t=>{
 const rpc=new RpcProcess({executable:process.execPath,args:['test/fixtures/rpc-server.mjs'],cwd:process.cwd(),env:process.env});t.after(()=>rpc.close());
 await assert.rejects(rpc.waitFor(()=>false,10),e=>{assert.deepEqual(agentFailureDiagnostic(e),{code:'codex_event_timeout'});return true;});
 await assert.rejects(rpc.request('malformed'),e=>{assert.deepEqual(agentFailureDiagnostic(e),{code:'codex_protocol_error'});return true;});
});

test("safe diagnostics retain actionable machine fields through wrappers and omit all free text", () => {
  const cause = {
    message: "PRIVATE_PROMPT",
    additionalDetails: "PRIVATE_DETAILS",
    codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } },
    data: { token: "PRIVATE_TOKEN" },
  };
  const e = Object.assign(new Error("PRIVATE_MESSAGE"), {
    code: "agent_failed",
    diagnostic: {
      stage: "turn_wait",
      rpcMethod: "turn/start",
      rpcCode: -32600,
      private: "PRIVATE_FIELD",
    },
    cause,
  });
  const result = agentFailureDiagnostic(e);
  assert.deepEqual(result, {
    code: "agent_failed",
    stage: "turn_wait",
    rpcMethod: "turn/start",
    rpcCode: -32600,
    codexErrorInfo: "httpConnectionFailed",
    httpStatusCode: 401,
  });
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  const wrapped = Object.assign(new Error("PRIVATE_WRAPPER"), {
    code: "mcp_config_failed",
    cause: e,
  });
  assert.equal(agentFailureDiagnostic(wrapped).httpStatusCode, 401);
});

test("diagnostics reject arbitrary metadata, classify safe known failures, and bound cyclic causes", () => {
  const e = Object.assign(
    new Error(
      "Invalid request: dynamic tools must use either canonical or legacy format consistently PRIVATE_SECRET",
    ),
    {
      code: "PRIVATE_CODE",
      diagnostic: {
        stage: "PRIVATE_STAGE",
        rpcMethod: "PRIVATE_METHOD",
        exitCode: 2,
        signal: "SIGTERM",
        rpcCode: "PRIVATE_RPC_CODE",
      },
    },
  );
  e.cause = e;
  assert.deepEqual(agentFailureDiagnostic(e), {
    code: "unknown",
    exitCode: 2,
    signal: "SIGTERM",
    reason: "mixed_dynamic_tool_formats",
  });
  const unknown = Object.assign(new Error("PRIVATE_UNKNOWN"), {
    codexErrorInfo: { PRIVATE_INFO: { httpStatusCode: "PRIVATE_STATUS" } },
  });
  assert.deepEqual(agentFailureDiagnostic(unknown), { code: "unknown" });
});

test("RPC rejection retains method, numeric code and machine error info without exposing payloads", async (t) => {
  const rpc = new RpcProcess({
    executable: process.execPath,
    args: ["test/fixtures/rpc-server.mjs"],
    cwd: process.cwd(),
    env: process.env,
  });
  t.after(() => rpc.close());
  await assert.rejects(
    rpc.request("reject", { secret: "PRIVATE_REQUEST" }),
    (e) => {
      assert.equal(e.code, "codex_rpc_rejected");
      assert.equal(e.diagnostic.rpcMethod, "reject");
      assert.equal(e.diagnostic.rpcCode, -32600);
      assert.equal(e.cause.message, "Invalid request: PRIVATE_RESPONSE");
      return true;
    },
  );
});
