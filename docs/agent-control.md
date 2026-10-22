# Agent cancellation and context management

[Wiki home](index.md) · [Agents](agents.md) · [Commands](commands.md) · [Agent tools](agent-contract.md)

## Commands

| Command | Access | Behavior |
| --- | --- | --- |
| `/agent context [AGENT_ID]` | Admin/owner even without an ID | Read the last root-context token estimate, measurement time and control phase. Does not create a thread or wake work. |
| `/agent compact [AGENT_ID]` | Admin/owner | Compact an existing enabled agent after active work and the already admitted queue prefix. Later arrivals wait. No extra arguments or preparation turn. |
| `/agent cancel [AGENT_ID]` | Current private chat: user+; current group: manager+. An explicit ID always requires admin/owner. | Interrupt current compute work and owned children/commands, preserve its thread and pending input, and pause dispatch. |

Targets belong to this bot. These actions do not accept `*`, `in CHAT_ID` or `default`. Cancellation never creates an agent or enables a disabled one. Repeated cancellation is safe. The next accepted event from any source wakes a cancel-pause only after interruption is confirmed. Existing queued events, status reads and startup recovery of old scheduled events do not wake it. `/agent start` explicitly releases a cancel-pause, while unknown/active maintenance holds remain effective.

Cancellation preserves completed Telegram sends, filesystem changes and other effects. The next real batch receives `agent_cancelled` with interrupted work/turn IDs before ordinary events; the notice alone does not trigger work. Do not replay consumed requests blindly. Interrupted scheduled work remains explicitly retryable; it is not acknowledged successful or automatically repeated. Delegated origins receive `agent_error` with `error:"agent_cancelled"`.

Cancel suppresses pending compaction and continuation. A running compaction finishes under a hold, without continuation. Stop, clear, rule replacement and deletion invalidate old continuation; clear/rules preserve an existing cancel-pause. Persistent widgets and connections are independent of cancelled compute work.

## Estimates and policy

Every actual Codex start/steer batch begins with one `context_status` event. Ordinary status metadata never occupies queue capacity, enters Telegram history or starts a turn. The `context_status` tool accepts no arguments and returns the same last-known snapshot:

```json
{"usedTokens":12000,"maxTokens":200000,"measuredAt":"2026-10-23T00:00:00.000Z"}
```

Usage is native last-request `totalTokens`, not cumulative accounting or a sum of children. It is an estimate, not an exact live count. Unknown fields are null. Resume, model changes and confirmed compaction invalidate usage until another measurement; a known window may remain after compaction. Administrative output uses `unknown` and never shows continuation or private origins.

There are no controller percentage thresholds. The owner sets policy in AGENTS.md: when to save durable facts and request compaction. Compaction does not save game canon, close chapters or commit files.

## Compaction and continuation

`compact_context({continuation?})` is root-thread-only. Optional continuation must be a nonempty string of at most 4096 Unicode code points. No model, summary template or target-size parameter is accepted; native compaction receives only `threadId`.

Acceptance returns `{status:"accepted",operationId,finishTurn:true}`. Finish the current compute turn; further mutations from that suspending work are refused. The controller waits for compute work, owned children and started controller effects. One pending/running operation is allowed per agent. Repeats report `already_pending`; a conflicting continuation cannot replace the saved instruction.

Without continuation, an empty external queue stays idle after compaction. With continuation, the instruction is stored outside compressed history and delivered once in the resumed batch's first status event, followed by newer eligible input:

```json
[
  {"eventType":"context_status","usedTokens":null,"maxTokens":200000,"measuredAt":null,"continuation":"Finish the pending scene using saved canon."},
  {"eventType":"message","messageId":42,"textPlain":"Use the corrected instruction."}
]
```

The continuation can trigger one resume with no external input. Later status events, tool results and admin views omit it. It does not outrank new input or current rules. Scheduled/delegated origins belong to the logical work across compute turns; the intermediate turn does not acknowledge success. Private routes retain their original access/lifetime constraints without public fallback.

## Overflow and recovery

The ten-entry limit counts waiting chat items: ordinary messages, separate edits, whole collected albums, ordinary callbacks and `/say`. A successfully admitted new chat item evicts the oldest waiting chat item. Source order is otherwise preserved. Schedule, agent/errors, WebSocket, widget, inline, guest and inline-button sources do not consume or evict these slots. Failed admission leaves the old entry intact; the first-event 200 ms collection deadline never extends.

Evicted ordinary messages/edits/albums remain in saved history and set `historyGap` for the next suitable event of that chat/topic, including private chats. Evicted `/say` edits its own confirmed prepared private reply to `Request was removed from the queue because newer messages arrived. Please send it again.` It creates no ordinary gap/public fallback, and duplicate delivery cannot revive it. An evicted grouped ordinary callback restores only its own unchanged group, preserving current text, other groups and permits. Controller `closed` clears only after confirmed restoration. Deleted/replaced/ambiguous or uncertain targets are not blindly edited. Ungrouped, inline and widget buttons have separate behavior.

Control intent, pause, native evidence and continuation submission state are durable. The ordinary queue remains RAM-only. ACK is not completion. Definitive failure does not automatically retry compaction. Missing/ambiguous native completion or launch evidence holds the queue as unknown, including after restart; an absent fresh in-memory session does not prove old work stopped. Inspect status/context. Explicit clear/stop can retire the owning context; start does not override unknown or maintenance holds.

Windows native servers join an unnamed Job Object before initialization; kill-on-close and accounting provide termination evidence. Failed ownership prevents model startup. Windows uses the existing .NET Framework compiler. See [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). Linux requires `python3` and `/proc`: an App Server supervisor becomes a child subreaper before spawning the native process. It kills and reaps all descendants, including detached double-forked commands, before confirming cancellation. Failed supervision prevents startup; missing evidence remains unknown. See [Linux child subreapers](https://www.man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html). See development verification for actual platform coverage.

Safe terminal control/work/reply/rollback metadata expires after 30 days. Pending and unknown control metadata stays protected; owner/message lifecycle deletion removes related records. Continuation and private addresses must not appear in general logs. Reply preparation and edits persist intent before their external effect; unknown delivery is not automatically resent.
