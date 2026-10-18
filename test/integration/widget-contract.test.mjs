import test from "node:test";
import assert from "node:assert/strict";
import {
  validateWidgetState,
  validateWidgetEvent,
  validateSetWidget,
  assertActionName,
} from "../../src/widgets/contract.mjs";
test("state rejects unsupported values and is capped in UTF-8 bytes", () => {
  for (const state of [
    { a: NaN },
    { a: () => 0 },
    { a: new Date() },
    [],
  ])
    assert.throws(() => validateWidgetState(state), /invalid_argument/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => validateWidgetState(cycle), /invalid_argument/);
  assert.doesNotThrow(() => validateWidgetState({ x: "a".repeat(1048568) }));
  assert.throws(
    () => validateWidgetState({ x: "a".repeat(1048569) }),
    /state_too_large/,
  );
});
test("debug state budget is distinct from external event budget", () => {
  const state = { text: "x".repeat(70000) };
  assert.doesNotThrow(() => validateWidgetState(state));
  assert.throws(
    () =>
      validateWidgetEvent({
        name: "vote",
        source: "agent",
        receivedAt: new Date(0).toISOString(),
        delayed: false,
        data: state,
      }),
    /event_too_large/,
  );
});
test("set selectors, descriptions and creation-only options are unambiguous", () => {
  assert.doesNotThrow(() =>
    validateSetWidget({ handler: "widgets/page.tsx", description: "Pages" }),
  );
  assert.throws(
    () => validateSetWidget({ handler: "w.tsx" }),
    /invalid_argument/,
  );
  assert.throws(
    () => validateSetWidget({ widgetId: "w", chatId: 1 }),
    /invalid_argument/,
  );
  assert.throws(
    () =>
      validateSetWidget({
        messageId: 7,
        handler: "w.tsx",
        description: "Pages",
        disable_notification: true,
      }),
    /invalid_argument/,
  );
  assert.doesNotThrow(() =>
    validateSetWidget({ widgetId: "w" }, { status: "disabled" }),
  );
  assert.doesNotThrow(
    () => validateSetWidget({ widgetId: "w" }, { status: "active" }),
  );
  assert.throws(
    () =>
      validateSetWidget({ handler: "w.tsx", description: "Pages", foreign: 1 }),
    /invalid_argument/,
  );
});
test("inline source is rejected with file-authoring guidance before widget admission", () => {
  for (const handler of [
    "export function render(state) { return <b>Counter</b>; }",
    "import {jsx} from '@tg-assistant/widget';\nexport function render(){return {text:'Counter'}}",
    "export function render(){return {blocks:[{type:'paragraph',text:'Counter'}]}}",
  ])
    assert.throws(
      () => validateSetWidget({ handler, description: "Counter" }),
      /handler must be a path.*write.*file.*not.*source code/i,
    );
  assert.doesNotThrow(() =>
    validateSetWidget({
      handler: "widgets/shared counter.tsx",
      description: "Counter",
    }),
  );
});
test("system exports and hostile names cannot be actions", () => {
  for (const n of [
    "render",
    "onInit",
    "onCreate",
    "onReply",
    "onReaction",
    "onPoll",
    "onPollAnswer",
    "onStop",
    "onError",
    "__proto__",
    "__render",
    "__external",
    "__cancel",
    "constructor",
    "a".repeat(65),
  ])
    assert.throws(() => assertActionName(n), /invalid_argument/);
  assert.equal(assertActionName("vote"), "vote");
});
