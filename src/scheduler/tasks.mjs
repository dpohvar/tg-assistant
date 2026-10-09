import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { nextRun, scheduleCron } from './zoned-cron.mjs';
export class Scheduler {
  handles = new Map(); queued = new Set(); retries = new Set();
  constructor({ db, enqueue, notify = () => {}, clock = Date.now, timers = true }) { Object.assign(this, { db, enqueue, notify, clock, timers }); }
  task(taskId) { return this.db.sql.prepare('SELECT * FROM tasks WHERE taskId=?').get(taskId); }
  schedule(scope, args) {
    if (typeof args.description !== 'string' || [...args.description].length > 100 || !args.description || typeof args.text !== 'string' || !args.text || Boolean(args.at) === Boolean(args.cron)) throw new Error('Provide description/text and exactly one of at or cron.');
    if (args.at && (!/(Z|[+-]\d\d:\d\d)$/.test(args.at) || !Number.isFinite(Date.parse(args.at)))) throw new Error('at must have an explicit time offset.');
    if (args.cron) nextRun(args.cron, args.timezone, this.clock());
    const taskId = 't' + randomUUID().replaceAll('-', '');
    this.db.sql.prepare('INSERT INTO tasks(taskId,agentId,description,text,at,cron,timezone,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(taskId, scope.agentId, args.description, args.text, args.at ?? null, args.cron ?? null, args.timezone ?? null, this.clock());
    this.arm(this.task(taskId)); return { taskId };
  }
  arm(task) {
    if (!this.timers) return;
    if (task.cron) this.handles.set(task.taskId, scheduleCron(task.cron, task.timezone, at => this.fire(task.taskId, at.getTime()), () => this.notify(task, 'Timer failed.')));
    else if (Date.parse(task.at) <= this.clock()) this.fire(task.taskId, Date.parse(task.at));
    else this.handles.set(task.taskId, new Cron(new Date(task.at), { maxRuns: 1, catch: () => this.notify(task, 'Timer failed.') }, () => this.fire(task.taskId, Date.parse(task.at))));
  }
  fire(taskId, at) {
    const t = this.task(taskId); if (!t) return;
    this.db.sql.prepare("INSERT INTO task_firings(taskId,state,firstAt,lastAt,count) VALUES(?,'pending',?,?,1) ON CONFLICT(taskId,state) DO UPDATE SET lastAt=excluded.lastAt,count=count+1").run(taskId, at, at);
    if(!this.enabled(t.agentId))this.disable(t.agentId);
    this.offer(taskId);
  }
  enabled(agentId) { return Boolean(this.db.sql.prepare('SELECT agentEnabled FROM chats JOIN agents USING(botId,chatId) WHERE agentId=?').get(agentId)?.agentEnabled); }
  disable(agentId) { for(const t of this.db.sql.prepare('SELECT taskId FROM tasks WHERE agentId=?').all(agentId)) { this.queued.delete(t.taskId); this.retries.delete(t.taskId); this.db.sql.prepare("UPDATE task_firings SET missedReason='agent_disabled' WHERE taskId=? AND state='pending'").run(t.taskId); } }
  resume(agentId) { const ids=this.db.sql.prepare("SELECT tasks.taskId FROM tasks JOIN task_firings USING(taskId) WHERE agentId=? AND state='pending'").all(agentId); for(const t of ids)this.offer(t.taskId); return ids.length; }
  offer(taskId) {
    if (this.queued.has(taskId) || this.db.sql.prepare("SELECT 1 FROM task_firings WHERE taskId=? AND state='processing'").get(taskId)) return;
    const t = this.task(taskId); if (t && !this.enabled(t.agentId)) { this.disable(t.agentId); return; } if (!t || !this.db.sql.prepare("SELECT 1 FROM task_firings WHERE taskId=? AND state='pending'").get(taskId)) return;
    this.queued.add(taskId); this.enqueue(t.agentId, { eventType: 'scheduled', taskId });
  }
  take(taskId) {
    this.queued.delete(taskId); const retry = this.retries.delete(taskId); const t = this.task(taskId); if (!t) return null;
    const pending = this.db.sql.prepare("SELECT * FROM task_firings WHERE taskId=? AND state='pending'").get(taskId); if (!pending) return null;
    this.db.sql.prepare("UPDATE task_firings SET state='processing' WHERE taskId=? AND state='pending'").run(taskId);
    return { eventType: 'scheduled', taskId, ...(retry ? { retry: true } : {}), ...(pending.missedReason ? { missedReason:pending.missedReason } : {}), scheduledAt: new Date(pending.firstAt).toISOString(), text: t.text, ...(t.cron ? { timezone: t.timezone } : {}), ...(pending.count > 1 ? { occurrences: pending.count, lastScheduledAt: new Date(pending.lastAt).toISOString() } : {}) };
  }
  complete(taskId, success) {
    const t = this.task(taskId); if (!t) return;
    const active = this.db.sql.prepare("SELECT * FROM task_firings WHERE taskId=? AND state='processing'").get(taskId); if (!active) return;
    this.db.transaction(() => {
      this.db.sql.prepare("DELETE FROM task_firings WHERE taskId=? AND state='processing'").run(taskId);
      if (success) { if (!t.cron) this.db.sql.prepare('DELETE FROM tasks WHERE taskId=?').run(taskId); else this.db.sql.prepare('UPDATE tasks SET notified=0 WHERE taskId=?').run(taskId); }
      else this.db.sql.prepare("INSERT INTO task_firings(taskId,state,firstAt,lastAt,count,failed) VALUES(?,'pending',?,?,?,1) ON CONFLICT(taskId,state) DO UPDATE SET firstAt=MIN(firstAt,excluded.firstAt),lastAt=MAX(lastAt,excluded.lastAt),count=count+excluded.count,failed=1").run(taskId, active.firstAt, active.lastAt, active.count);
    });
    if (!success && !t.notified) { this.db.sql.prepare('UPDATE tasks SET notified=1 WHERE taskId=?').run(taskId); this.notify(t, 'Scheduled action failed. Retry may repeat previously completed effects.'); }
    if (success) this.offer(taskId);
  }
  recover() {
    this.queued.clear(); this.retries.clear();
    for (const r of this.db.sql.prepare("SELECT taskId FROM task_firings WHERE state='processing'").all()) this.complete(r.taskId, false);
    for (const t of this.db.sql.prepare('SELECT * FROM tasks').all()) { if (!this.db.sql.prepare('SELECT 1 FROM task_firings WHERE taskId=?').get(t.taskId)) this.arm(t); else { this.offer(t.taskId); if (t.cron) this.arm(t); } }
  }
  retry(taskId) {
    if (!this.enabled(this.task(taskId)?.agentId)) throw new Error('Agent is disabled. Use /agent start first.');
    if (this.queued.has(taskId) || this.db.sql.prepare("SELECT 1 FROM task_firings WHERE taskId=? AND state='processing'").get(taskId)) throw new Error('Event is being processed.');
    if (!this.db.sql.prepare("SELECT 1 FROM task_firings WHERE taskId=? AND state='pending' AND (failed=1 OR missedReason IS NOT NULL)").get(taskId)) throw new Error('No missed event is available to retry.');
    this.retries.add(taskId); this.offer(taskId);
  }
  failQueued(agentId) {
    for (const taskId of [...this.queued]) {
      const task = this.task(taskId); if (task?.agentId !== agentId) continue;
      this.queued.delete(taskId); this.retries.delete(taskId);
      this.db.sql.prepare("UPDATE task_firings SET failed=1 WHERE taskId=? AND state='pending'").run(taskId);
      if (!task.notified) {
        this.db.sql.prepare('UPDATE tasks SET notified=1 WHERE taskId=?').run(taskId);
        this.notify(task, 'The agent queue was cleared before this action could be processed.');
      }
    }
  }
  list(scope, taskIds) { return { tasks: this.db.sql.prepare('SELECT * FROM tasks WHERE agentId=? ORDER BY createdAt,taskId').all(scope.agentId).filter(t => !taskIds || taskIds.includes(t.taskId)).map(t => { const { agentId, text, notified, ...rest } = t; return { ...rest, ...(taskIds ? { text } : {}) }; }) }; }
  cancel(scope, taskIds) { for (const id of taskIds) if (this.task(id)?.agentId === scope.agentId) { this.handles.get(id)?.stop(); this.handles.delete(id); this.queued.delete(id); this.retries.delete(id); this.db.sql.prepare('DELETE FROM tasks WHERE taskId=?').run(id); } return { status: 'cancelled' }; }
  close() { for (const h of this.handles.values()) h.stop(); this.handles.clear(); }
}
