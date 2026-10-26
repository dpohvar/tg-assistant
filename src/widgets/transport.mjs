import { WebSocket, WebSocketServer } from "ws";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WIDGET_LIMITS, widgetError } from "./contract.mjs";
function rpc(socket, handle) {
  let seq = 0,
    closed = false;
  const waiting = new Map();
  const fail = () => {
    closed = true;
    for (const p of waiting.values())
      p.reject(widgetError("widget_stopped", "Runtime disconnected."));
    waiting.clear();
  };
  socket.on("close", fail);
  socket.on("error", fail);
  socket.on("message", async (bytes) => {
    let m;
    try {
      if (bytes.length > WIDGET_LIMITS.frameBytes) throw 0;
      m = JSON.parse(bytes.toString());
      if (!m || !Number.isSafeInteger(m.id) || typeof m.request !== "boolean")
        throw 0;
    } catch {
      socket.close(1008);
      return;
    }
    if (!m.request) {
      const p = waiting.get(m.id);
      if (!p) {
        socket.close(1008);
        return;
      }
      waiting.delete(m.id);
      m.error
        ? p.reject(
            Object.assign(
              widgetError(m.error.code ?? "widget_failed", m.error.message),
              Object.fromEntries(
                ["widgetId", "confirmedMessageId", "viewId", "phase", "status", "ownerAgentId", "causeCode", "updatedViews", "failedViews"]
                  .filter((k) => m.error[k] !== undefined)
                  .map((k) => [k, m.error[k]]),
              ),
            ),
          )
        : p.resolve(m.result);
      return;
    }
    if (typeof m.method !== "string") {
      socket.close(1008);
      return;
    }
    let response;
    try {
      response = {
        id: m.id,
        request: false,
        result: (await handle(m.method, m.args)) ?? null,
      };
    } catch (e) {
      response = {
        id: m.id,
        request: false,
        error: {
          code: e.code ?? "widget_failed",
          message: String(e.message).slice(0, 1000),
          ...Object.fromEntries(
            ["widgetId", "confirmedMessageId", "viewId", "phase", "status", "ownerAgentId", "causeCode", "updatedViews", "failedViews"]
              .filter((k) => e[k] !== undefined)
              .map((k) => [k, e[k]]),
          ),
        },
      };
    }
    try {
      send(response);
    } catch {
      socket.close(1008);
    }
  });
  function send(value) {
    const s = JSON.stringify(value);
    if (Buffer.byteLength(s) > WIDGET_LIMITS.frameBytes)
      throw widgetError("event_too_large", "Transport frame too large.");
    if (closed || socket.readyState !== WebSocket.OPEN)
      throw widgetError("widget_stopped");
    socket.send(s);
  }
  return {
    request(method, args) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject });
        try {
          send({ id, request: true, method, args });
        } catch (e) {
          waiting.delete(id);
          reject(e);
        }
      });
    },
    close() {
      fail();
      socket.terminate();
    },
  };
}
export async function createWidgetTransport({ handle }) {
  const capability = randomBytes(32).toString("hex");
  let peer, resolveConnected, rejectConnected;
  const connected = new Promise((r, j) => {
    resolveConnected = r;
    rejectConnected = j;
  });
  connected.catch(() => {});
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    maxPayload: WIDGET_LIMITS.frameBytes,
    verifyClient: ({ req }) => {
      const got = Buffer.from(req.headers.authorization ?? ""),
        want = Buffer.from("Bearer " + capability);
      return !peer && got.length === want.length && timingSafeEqual(got, want);
    },
  });
  await new Promise((r, j) => {
    server.once("listening", r);
    server.once("error", j);
  });
  const url = `ws://127.0.0.1:${server.address().port}`;
  server.on("connection", (s) => {
    if (peer) {
      s.terminate();
      return;
    }
    peer = rpc(s, handle);
    resolveConnected();
  });
  return {
    url,
    bootstrap: { url, capability },
    connected,
    request(method, args) {
      if (!peer) return Promise.reject(widgetError("widget_stopped"));
      return peer.request(method, args);
    },
    close() {
      rejectConnected(widgetError("widget_stopped"));
      peer?.close();
      for (const c of server.clients) c.terminate();
      return new Promise((r) => server.close(r));
    },
  };
}
export async function connectWidgetTransport({ url, capability, handle }) {
  const socket = new WebSocket(url, {
    headers: { Authorization: "Bearer " + capability },
    maxPayload: WIDGET_LIMITS.frameBytes,
  });
  const peer = rpc(socket, handle);
  await new Promise((r, j) => {
    socket.once("open", r);
    socket.once("error", j);
  });
  return peer;
}
