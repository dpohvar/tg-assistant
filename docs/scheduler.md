# Scheduler

Tasks belong to an agent's chat and are stored in SQLite. Their events enter the same agent queue as messages but do not consume its ten chat-entry slots. Administrator task commands are documented in [commands](commands.md); agent tools are documented in the [agent contract](agent-contract.md).

## Creating tasks

`schedule` requires a nonempty `description` of at most 100 Unicode code points and a nonempty `text` instruction. Supply exactly one of:

- `at`: an ISO 8601 instant with `Z` or an explicit numeric offset.
- `cron`: a five-field, minute-resolution expression and an IANA `timezone`.

Use the `time` tool for relative requests. The configured default time zone is provided in instructions; the agent must supply the intended zone for cron. Text should be self-contained because a future event may arrive in a fresh or compacted context.

```json
{"description":"Meeting reminder","text":"Send the user a reminder that the meeting starts now.","at":"2026-10-11T09:00:00+03:00"}
```

```json
{"description":"Weekend digest","text":"Summarize the recent group discussion and send a short digest.","cron":"0 9 * * SAT,SUN","timezone":"Asia/Nicosia"}
```

`tasks` lists task metadata without instructions; passing `taskIds` includes full text for those tasks. `cancel_tasks` only removes tasks owned by the current agent.

## Calendar behavior

Croner 10.0.1 parses the calendar expression. A controller adapter uses Temporal to map candidate local times to real instants. Seconds fields, `everySeconds`, and cron-as-a-substitute-for-one-time tasks are not supported.

The adapter skips nonexistent local times during a daylight-saving gap. During a repeated hour it chooses the earlier occurrence only. Croner's five-field syntax supports lists, ranges, steps, month/day names, and its calendar extensions; day-of-month/day-of-week use Croner's default OR behavior unless its explicit AND syntax is used. Invalid expressions or zones fail at creation. The adapter bounds its candidate search at 10,000 dates rather than looping forever on an impossible calendar.

Cron timers are rearmed from actual current time. Occurrences while the service is down are not reconstructed. Stored pending occurrences are retained; overdue one-time tasks are still offered after restart.

## Coalescing and completion

Each task has at most one pending aggregate and one processing aggregate. While the task is already processing, later cron occurrences accumulate in the pending aggregate rather than adding repeated queue entries. While an agent is busy with another task, queued occurrences also merge.

At dispatch the event contains the first `scheduledAt`, full `text`, and `timezone` for cron. An aggregate with multiple occurrences also contains `occurrences` and `lastScheduledAt`. `occurrences` includes the represented first occurrence, so a value of four represents four due actions, not four additional misses.

```json
{
  "eventType":"scheduled",
  "taskId":"t123",
  "scheduledAt":"2026-10-11T06:00:00.000Z",
  "text":"Publish the weekend digest if it is still useful.",
  "timezone":"Asia/Nicosia",
  "occurrences":3,
  "lastScheduledAt":"2026-10-25T07:00:00.000Z"
}
```

Completion is tied to the whole work unit, including pending subagents, rather than individual tool calls. A successful unit removes a one-time task or acknowledges a cron aggregate and offers the next pending aggregate. There is no `complete_tasks` tool. If one scheduled action succeeds but the same unit later fails on other work, that action can still be marked unsuccessful.

This is not exactly-once execution. A crash after publishing but before acknowledgement can cause a retry to publish again. Instructions and retries should account for possible already completed effects.

## Disabled agents and failures

Tasks and schedules survive `/agent stop`. Due occurrences are stored but not dispatched while disabled; they carry `missedReason: "agent_disabled"` when offered after `/agent start`. The agent assesses whether a delayed action remains useful and should not blindly replay every missed cron occurrence.

A technical failure returns processing firings to pending, marks affected queued firings failed, and sends a compact text notification in the task's own chat. It includes task ID, agent ID, schedule, missed count, explanation, and retry/delete commands. A cron task sends only its first failure notification until a successful processing resets the notification flag.

Retry requires a failed or otherwise missed pending event, an enabled agent, and no existing queued/processing occurrence. Retry events include `retry: true`. Commands can retry or delete all eligible tasks in a chat. Deletion cancels future timers and prevents stale queued events from becoming work; it does not undo actions already performed.

Recovery treats previously processing firings as failed. Notes, schedules, pending aggregates, and failure-notification state are durable. Ordinary queue loss and restart behavior are described in [storage](storage.md).
