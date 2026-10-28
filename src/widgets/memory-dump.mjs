const MAX_PROCESSES = 256;
const MAX_WIDGETS = 256;

/** Save one bounded, agent-readable diagnostic for a runtime RSS limit failure. */
export function writeWidgetMemoryDump({ owner, sample, store, filesFor, clock = Date.now }) {
  const processes = Array.isArray(sample.processes) ? sample.processes : [];
  const widgets = store.list(owner);
  const dump = {
    type: "widget_runtime_memory_limit",
    capturedAt: new Date(clock()).toISOString(),
    owner: { botId: owner.botId, agentId: owner.agentId },
    memory: { usedBytes: sample.bytes, limitBytes: sample.limitBytes,
      processCount: processes.length },
    processes: processes.slice(0, MAX_PROCESSES).map(({ pid, ppid, start, bytes }) =>
      ({ pid, ppid, start, rssBytes: bytes })),
    omittedProcesses: Math.max(0, processes.length - MAX_PROCESSES),
    widgets: widgets.slice(0, MAX_WIDGETS).map(widget => ({
      widgetId: widget.widgetId, handler: widget.handler, status: widget.status,
      viewCount: store.listViews(widget.widgetId).length,
    })),
    omittedWidgets: Math.max(0, widgets.length - MAX_WIDGETS),
  };
  const relativePath = `.temp/${owner.agentId}/widget-memory-dump.json`;
  filesFor(owner).write(relativePath, Buffer.from(JSON.stringify(dump) + "\n"));
  return relativePath;
}

export async function reportWidgetMemoryFailure({ owner, error, store, filesFor, manager }) {
  if (error.memorySample) {
    try { error.diagnosticPath = writeWidgetMemoryDump({
      owner, sample: error.memorySample, store, filesFor,
    }); }
    catch { error.diagnosticUnavailable = true; }
  }
  await manager.failure(owner, error);
}
