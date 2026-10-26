import test from "node:test";
import assert from "node:assert/strict";
import { trackTree } from "../../src/widgets/monitor.mjs";
test("process identities prevent PID reuse and retain detached descendants", () => {
  const tracked = new Map([[1, "10"]]);
  assert.deepEqual(
    trackTree(
      [
        { pid: 1, ppid: 0, start: "10", bytes: 10 },
        { pid: 2, ppid: 1, start: "11", bytes: 20 },
      ],
      tracked,
    ).map((x) => x.pid),
    [1, 2],
  );
  assert.deepEqual(
    trackTree(
      [
        { pid: 2, ppid: 0, start: "11", bytes: 20 },
        { pid: 1, ppid: 0, start: "99", bytes: 900 },
      ],
      tracked,
    ).map((x) => x.pid),
    [2],
  );
});
