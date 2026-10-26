import test from "node:test";
import assert from "node:assert/strict";
import * as contract from "../../src/widgets/contract.mjs";

test("React mount requires one unambiguous target", () => {
  assert.equal(typeof contract.validateReactMount, "function");
  assert.throws(() => contract.validateReactMount({ target: { chatId: 1, inlineMessageId: "opaque" }, component: "Main", props: {} }), /invalid_argument/);
  assert.throws(() => contract.validateReactMount({ target: { chatId: 1, receiverUserId: 2, messageId: 3 }, component: "Main", props: {} }), /invalid_argument/);
  assert.deepEqual(contract.validateReactMount({ target: { inlineMessageId: "opaque" }, component: "Main", props: { count: 2 } }).target, { inlineMessageId: "opaque" });
});

test("ordinary roots require an exported component and lossless JSON props", () => {
  assert.throws(() => contract.validateReactMount({ target: { chatId: 1 }, component: () => null, props: {} }), /invalid_argument/);
  assert.throws(() => contract.validateReactMount({ target: { chatId: 1 }, component: "Main", props: { fn: () => 1 } }), /invalid_argument/);
  assert.throws(() => contract.validateReactMount({ target: { chatId: 1 }, component: "Main", props: { n: NaN } }), /invalid_argument/);
  assert.throws(() => contract.validateReactMount({ target: { chatId: 1 }, component: "Main", props: { x: undefined } }), /invalid_argument/);
});

test("live ephemeral renderer props are confined to runtime-origin mounts", () => {
  const fn = () => null;
  const input = { target: { chatId: 1, receiverUserId: 2 }, component: fn, props: { fn }, origin: "runtime" };
  assert.equal(contract.validateReactMount(input).props.fn, fn);
  assert.deepEqual(contract.validateReactMount({ ...input,
    target:{chatId:1,receiverUserId:2,callbackQueryId:"fresh",replaceCallbackQueryMessage:true}
  }).target.callbackQueryId,"fresh");
  assert.throws(() => contract.validateReactMount({ ...input, origin: "agent" }), /invalid_argument/);
  assert.throws(() => contract.validateReactMount({ ...input, target: { chatId: 1 } }), /invalid_argument/);
});

test("state retains framework normalization; agent requests remain strict", () => {
  assert.equal(typeof contract.validateReactState, "function");
  assert.deepEqual(contract.validateReactState({ a: undefined, b: [undefined, 1] }), { b: [null, 1] });
  assert.equal(typeof contract.validateAgentRequestPayload, "function");
  assert.deepEqual(contract.validateAgentRequestPayload({ text: "go", data: { a: 1 } }), { text: "go", data: { a: 1 } });
  assert.throws(() => contract.validateAgentRequestPayload({ text: "go", data: { x: undefined } }), /invalid_argument/);
});
