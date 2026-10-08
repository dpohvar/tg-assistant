// Experimental controller adapter. No application queue or persistence here.
import { Cron } from 'croner';
import { Temporal } from '@js-temporal/polyfill';

function calendar(pattern) {
  if (typeof pattern !== 'string' || pattern.trim().split(/\s+/).length !== 5) {
    throw new TypeError('Expected a five-field cron expression');
  }
  return new Cron(pattern, { timezone: 'UTC', mode: '5-part', paused: true });
}
function instant(value) {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError('Invalid reference instant');
  return Temporal.Instant.fromEpochMilliseconds(ms);
}
function pseudoUTC(local) {
  return new Date(local.toZonedDateTime('UTC').epochMilliseconds);
}
function localFromUTC(date) {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO('UTC').toPlainDateTime();
}
function nextWithCalendar(job, timezone, after) {
  const reference = instant(after);
  let cursor = pseudoUTC(reference.toZonedDateTimeISO(timezone).toPlainDateTime());
  // A bounded search also handles a pattern whose every candidate is nonexistent.
  for (let attempt = 0; attempt < 10000; attempt++) {
    const candidate = job.nextRun(cursor);
    if (!candidate) return null;
    if (candidate.getTime() <= cursor.getTime()) throw new Error('Croner returned a non-increasing calendar date');
    cursor = candidate;
    const local = localFromUTC(candidate);
    const zoned = local.toZonedDateTime(timezone, { disambiguation: 'earlier' });
    // "earlier" picks the first fold occurrence, but shifts a gap backwards.
    // The round trip rejects that shifted/nonexistent local date.
    if (!zoned.toPlainDateTime().equals(local)) continue;
    if (Temporal.Instant.compare(zoned.toInstant(), reference) <= 0) continue;
    return new Date(zoned.epochMilliseconds);
  }
  throw new RangeError('No valid occurrence found within 10000 calendar candidates');
}

export function nextRun(pattern, timezone, after = new Date()) {
  const job = calendar(pattern);
  try { return nextWithCalendar(job, timezone, after); }
  finally { job.stop(); }
}
export function nextRuns(pattern, timezone, after, count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Invalid count');
  const job = calendar(pattern);
  try {
    const result = [];
    let cursor = after;
    // Validate even an empty request.
    instant(cursor).toZonedDateTimeISO(timezone);
    for (let i = 0; i < count; i++) {
      const next = nextWithCalendar(job, timezone, cursor);
      if (!next) break;
      result.push(next);
      cursor = next;
    }
    return result;
  } finally { job.stop(); }
}

export function scheduleCron(pattern, timezone, onFire, onError) {
  if (typeof onFire !== 'function' || typeof onError !== 'function') throw new TypeError('Callbacks are required');
  const job = calendar(pattern);
  let timer;
  let target;
  let stopped = false;
  const stop = () => { stopped = true; timer?.stop(); job.stop(); target = null; };
  const fail = error => { stop(); onError(error); };
  const arm = () => {
    target = nextWithCalendar(job, timezone, new Date());
    if (!target) return;
    const scheduledAt = target;
    timer = new Cron(scheduledAt, { timezone: 'UTC', maxRuns: 1, catch: fail }, () => {
      if (stopped) return;
      // Rearm from actual time: skip downtime; never wait for the agent's work.
      arm();
      return onFire(scheduledAt);
    });
  };
  try { arm(); } catch (error) { stop(); throw error; }
  return { stop, nextRun: () => target ? new Date(target.getTime()) : null };
}
