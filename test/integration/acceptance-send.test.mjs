import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceSend } from "../helpers/acceptance-send.mjs";

test("live acceptance permits only one scoped plain-text send and consumes uncertain attempts", async () => {
  const calls = [],
    marker = "LIVE CHECK",
    invoke = async (...args) => {
      calls.push(args);
      throw new Error("unknown delivery");
    };
  const send = acceptanceSend({ invoke, chatId: 7, marker });
  for (const [name, args] of [
    ["sticker_set_delete", { name: "existing" }],
    ["send", { text: marker, chatId: 8, disable_notification: true }],
    ["send", { text: marker, disable_notification: false }],
    [
      "send",
      { text: marker, disable_notification: true, uploads: { a: "file" } },
    ],
    ["send", { text: "unrelated", disable_notification: true }],
  ])
    assert.equal((await send(name, args)).error, "acceptance_scope");
  assert.equal(calls.length, 0);
  await assert.rejects(
    send("send", { text: marker + ".", disable_notification: true }),
    /unknown delivery/,
  );
  assert.deepEqual(calls, [
    ["send", { text: marker, chatId: 7, disable_notification: true }],
  ]);
  assert.equal(
    (await send("send", { text: marker, disable_notification: true })).error,
    "acceptance_scope",
  );
  assert.equal(calls.length, 1);
});
