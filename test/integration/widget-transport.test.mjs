import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import {
  createWidgetTransport,
  connectWidgetTransport,
} from "../../src/widgets/transport.mjs";
test("retained publication error IDs survive both RPC directions", async (t) => {
  const error = () => {
    throw Object.assign(new Error("storage gap"), {
      code: "storage_failed",
      widgetId: "w",
      confirmedMessageId: 71,
    });
  };
  const host = await createWidgetTransport({ handle: error });
  t.after(() => host.close());
  const client = await connectWidgetTransport({
    ...host.bootstrap,
    handle: error,
  });
  t.after(() => client.close());
  await host.connected;
  for (const peer of [host, client])
    await assert.rejects(
      () => peer.request("probe", {}),
      (e) =>
        e.widgetId === "w" &&
        e.confirmedMessageId === 71 &&
        e.code === "storage_failed",
    );
});
test("authenticated transport rejects wrong capability and unknown methods", async (t) => {
  const host = await createWidgetTransport({
    handle: async (m) => {
      if (m !== "allowed") throw new Error("denied");
      return 42;
    },
  });
  t.after(() => host.close());
  const wrong = new WebSocket(host.url, {
    headers: { Authorization: "Bearer wrong" },
  });
  await new Promise((r) => wrong.on("error", r));
  const client = await connectWidgetTransport({
    ...host.bootstrap,
    handle: async (m, a) => a,
  });
  t.after(() => client.close());
  await host.connected;
  assert.equal(await client.request("allowed", {}), 42);
  await assert.rejects(() => client.request("forbidden", {}), /denied/);
  assert.deepEqual(await host.request("echo", { x: 1 }), { x: 1 });
  client.close();
  await assert.rejects(() => host.request("echo", {}));
});
test("malformed frames revoke the transport", async (t) => {
  const h = await createWidgetTransport({ handle: async () => null });
  t.after(() => h.close());
  const c = new WebSocket(h.url, {
    headers: { Authorization: `Bearer ${h.bootstrap.capability}` },
  });
  await new Promise((r) => c.on("open", r));
  c.send("not JSON");
  await new Promise((r) => c.on("close", r));
  assert.equal(c.readyState, WebSocket.CLOSED);
});
import { createServer } from "node:http";
import { createHash } from "node:crypto";
test("first RPC frame coalesced with upgrade is never lost", async (t) => {
  const server = createServer();
  let connection,
    received = false;
  server.on("upgrade", (req, socket) => {
    connection = socket;
    socket.on("error", () => {});
    const accept = createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    const payload = Buffer.from(
      JSON.stringify({ id: 1, request: true, method: "early", args: {} }),
    );
    socket.write(
      Buffer.concat([
        Buffer.from(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        ),
        Buffer.from([0x81, payload.length]),
        payload,
      ]),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const client = await connectWidgetTransport({
    url: `ws://127.0.0.1:${server.address().port}`,
    capability: "fixture",
    handle: async () => {
      received = true;
    },
  });
  t.after(async () => {
    client.close();
    connection?.destroy();
    await new Promise((r) => server.close(r));
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(received, true);
});
