# WebSocket connections

The controller holds `ws`/`wss` connections independently of Codex turns. Incoming messages enter a per-connection FIFO buffer; only short notifications enter the ordinary agent queue. A socket does not keep an agent busy or automatically enable Telegram typing.

Connections belong to one agent of one bot. Agents can only operate their own records. Admin/owner may inspect, close, and delete connections of their bot using [child-bot commands](commands.md).

## Tools

| Tool | Arguments | Result |
|---|---|---|
| `ws_open` | `url`, `description`, optional `headers` | `{connectionId}` |
| `ws_list` | None | `{connections:[...]}` |
| `ws_pull` | `connectionId`, positive integer `count` | `{messages:[...],remaining}` |
| `ws_send` | `connectionId`, exactly one `text` or `path` | `{status:"sent"}` |
| `ws_close` | `connectionId` | `{status:"closed"}` |
| `ws_delete` | `connectionId` | `{status:"deleted"}` |

`description` is 1–100 Unicode code points and must not contain secrets. Headers have string values without newlines. The opening handshake has a 15-second timeout. Closing or deleting during a handshake settles the waiting open call with an error.

Build secret-bearing URLs or headers inside Codex JavaScript, using `vault_get` where appropriate, and print only safe results. Lists expose the origin rather than the full URL. The service does not apply a public-address-only filter to WebSocket destinations.

```json
{"url":"wss://example.com/events","description":"Receive build notifications"}
```

`ws_send` sends a text message verbatim or reads a permitted local file and sends it as binary. Each buffered element is one complete WebSocket message, not a frame. The controller does not parse text as JSON.

## Buffering and notifications

A transition from an empty to a nonempty buffer emits:

```json
{"eventType":"websocket_ready","connectionId":"w123"}
```

Identical waiting ready notifications are coalesced. Further packets in a nonempty buffer do not emit another ready event. If a pull leaves `remaining > 0`, the agent must keep pulling, schedule later work, or explicitly return to the connection. A notification can become stale and a pull can legitimately return an empty list.

`ws_pull` destructively removes up to `count` messages in FIFO order. It can be called within JavaScript to process many packets and print only a useful summary:

```json
{
  "messages":[
    {"type":"text","data":"{\"event\":\"done\"}"},
    {"type":"binary","bytes":128,"path":".temp/a123/websocket/w123/packet-2.bin"},
    {"type":"binary","bytes":256,"skipped":true,"reason":"binary_storage_full"}
  ],
  "remaining":0
}
```

Backend/admin closure emits `websocket_closed` with a safe reason such as `server`, `admin`, `transport_error`, `storage_error`, or `buffer_overflow`. An available server close code is included. Buffer overflow reports `droppedMessages: 1` for the rejected packet. Arbitrary server close strings are not forwarded. An agent's own close does not echo a notification.

Administrator deletion emits `websocket_deleted` with `reason: "admin"`; expiry deletion uses `reason: "expired"`. These events and ready notifications do not consume the ten chat-entry queue allowance.

## Limits and counters

| Limit | Behavior |
|---|---|
| Ten records per agent | Opening, open, and closed records all occupy slots; delete frees a slot |
| 10 MiB per incoming message | Larger messages are rejected by the transport |
| 1 MiB FIFO accounting per connection | UTF-8 text payload bytes plus serialized binary/skipped metadata; overflow closes the connection and preserves earlier buffered entries |
| Binary directory threshold of 10 MiB | Save a whole binary message if current directory size is at most the threshold; otherwise record a skipped message |
| One hour after first close | Delete the record, remaining buffer, and binary files |

One MiB is 1,048,576 bytes. Binary content is outside FIFO byte accounting. Because the directory check happens before writing a whole message, saved binary files can grow to 20 MiB with the accepted per-message limit. Skipping a binary packet because storage is full does not itself close the socket.

Each list record contains `connectionId`, `description`, `origin`, `status` (`opening`, `open`, `closed`), `openedAt`, optional `closedAt`, `receivedBytes`, `sentBytes`, `queued`, `queuedBytes`, and `binaryBytes`. Times are ISO 8601. Counters count received payloads and successful sends rather than transport headers. Pulling decreases FIFO size, not total received bytes.

## File and connection lifecycle

Binary files live under `.temp/AGENT_ID/websocket/CONNECTION_ID/`. Pulling does not delete them; the agent should delete processed files to free space. Move files elsewhere before `ws_delete` if they are still needed. A file already removed by cleanup returns as skipped with `reason: "file_expired"` when pulled.

Normal [temporary-file cleanup](storage.md) applies by `mtime`. Closed-connection expiry can remove files earlier. Repeated close does not extend the one-hour lifetime. Context clear, rules replacement, and agent stop close sockets; removal of the chat/bot deletes their resources. An MCP configuration refresh keeps sockets.

Records and buffers are in memory. Restart loses unread packets and does not reconnect. Startup removes old WebSocket directories for registered agents. Other temporary files remain under the normal cleanup policy. MCP over WebSocket is not supported; [HTTP MCP](mcp.md) is a separate native integration.
