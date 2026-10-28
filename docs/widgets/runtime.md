# Node.js runtime and sandbox

[Widget handbook](../widgets.md) · [Getting started](getting-started.md) · [JSX](jsx.md) · [State](state.md) · [Views](views.md)

Widget code runs in a foreground Node.js process in its owning agent's sandbox, independently of model turns. It can use Node.js built-in APIs for files, timers and networking, and can use packages available within the bot workspace. For example, it can read and write the agent's managed files or maintain a WebSocket connection. The filesystem and network still obey the agent sandbox and service limits; widget code has no direct access to the controller's Telegram token, private files of other bots, or arbitrary controller internals. Use `useTelegram()` for scoped Telegram and controller calls, including `ws_open`, `ws_pull`, `ws_send`, `ws_close`, and `ws_delete` when a controller-managed socket is preferable.

```tsx
import {readFile} from "node:fs/promises";
import {useEffect,useState} from "react";

export function Status(){
  const [status,setStatus]=useState("Loading");
  useEffect(()=>{
    let active=true;
    readFile("wiki/status.txt","utf8")
      .then(text=>{if(active)setStatus(text);})
      .catch(error=>{if(active)setStatus(error.message);});
    return ()=>{active=false;};
  },[]);
  return <p>{status}</p>;
}
```

Modules are compiled with esbuild for Node. Static TS/TSX/JS/JSON imports under the owner workspace and supported packages are bundled. Built-in `node:` imports remain available, except `worker_threads`, which the widget compiler rejects. Symlinked dependencies, imports outside the owner sandbox, native add-ons, unsupported assets, unresolved dynamic imports and top-level `await` are not supported by this build. Read non-code assets explicitly at runtime inside the sandbox. Keep long-lived assets in the permanent workspace, not `.temp`, and close timers/sockets in effect cleanup.

There is one foreground runtime process per agent owner, not per view. Blocking the event loop can stall all widgets of that owner, and background effects are subject to process restart and watchdog shutdown. The controller measures the entire process tree's resident memory every 500 ms and stops it above 512 MiB; up to 10 widget runtime processes may run per bot. There is no fixed count limit on widget registrations. `list_widgets` returns `memory:{usedBytes,limitBytes}` for the requesting agent's runtime. Usage is measured on demand; it is zero when the runtime is stopped and cannot be attributed accurately to individual widgets. A memory-limit failure reports the measured bytes, limit and process count in `get_widget.lastError` and the agent notification. It also replaces `.temp/<agentId>/widget-memory-dump.json` with one diagnostic containing the RSS of up to 256 processes and the IDs, handlers, statuses and view counts of up to 256 widgets. The dump omits widget state and props; omitted-item counts are included. The path appears in `get_widget.lastError.diagnosticPath` and the notification when writing succeeds. The dump is an agent temporary file and follows the [temporary-file cleanup policy](../storage.md). Use saved store state or explicit files for durable data. See [security](../security.md#widget-isolation) and [operations](../operations.md) for isolation and recovery details.
