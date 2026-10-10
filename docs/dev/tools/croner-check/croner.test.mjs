import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cron } from 'croner';

const calendar = (pattern, timezone = 'UTC') => new Cron(pattern, { timezone, mode: '5-part', paused: true });
function dates(pattern, from, count = 1, timezone = 'UTC') {
  const job = calendar(pattern, timezone);
  try { return job.nextRuns(count, new Date(from)).map(d => d.toISOString()); }
  finally { job.stop(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('five fields: minute precision, ranges and step', () => {
  assert.deepEqual(dates('* * * * *', '2026-10-07T12:00:01Z', 2), ['2026-10-07T12:01:00.000Z', '2026-10-07T12:02:00.000Z']);
  assert.deepEqual(dates('*/15 9-10 * * MON-FRI', '2026-10-09T10:46:00Z', 2), ['2026-10-12T09:00:00.000Z', '2026-10-12T09:15:00.000Z']);
  for (const p of ['* * * * * *', '* * * * * * 2026', '60 * * * *', '0 25 * * *', '0 9 * 13 *', '0 9 * * 8', '*/0 * * * *']) {
    assert.throws(() => calendar(p), undefined, p);
  }
});

test('weekends, named weekdays, Sunday 0 and 7', () => {
  assert.deepEqual(dates('0 9 * * SAT,SUN', '2026-10-09T10:00:00Z', 3), ['2026-10-10T09:00:00.000Z', '2026-10-11T09:00:00.000Z', '2026-10-17T09:00:00.000Z']);
  assert.deepEqual(dates('0 9 * * 0', '2026-10-09T10:00:00Z', 3), dates('0 9 * * 7', '2026-10-09T10:00:00Z', 3));
  assert.deepEqual(dates('0 9 * * sun', '2026-10-09T10:00:00Z', 3), dates('0 9 * * 0', '2026-10-09T10:00:00Z', 3));
});

test('day of month and week: OR default and explicit + AND', () => {
  assert.deepEqual(dates('0 9 1 * MON', '2026-09-30T10:00:00Z', 3), ['2026-10-01T09:00:00.000Z', '2026-10-05T09:00:00.000Z', '2026-10-12T09:00:00.000Z']);
  assert.deepEqual(dates('0 9 1 * +MON', '2026-09-30T10:00:00Z', 2), ['2027-02-01T09:00:00.000Z', '2027-03-01T09:00:00.000Z']);
});

test('calendar extensions: last day, nth weekday and leap day', () => {
  assert.deepEqual(dates('0 9 L * *', '2026-01-30T10:00:00Z', 3), ['2026-01-31T09:00:00.000Z', '2026-02-28T09:00:00.000Z', '2026-03-31T09:00:00.000Z']);
  assert.deepEqual(dates('0 9 * * MON#2', '2026-10-01T00:00:00Z', 2), ['2026-10-12T09:00:00.000Z', '2026-11-09T09:00:00.000Z']);
  assert.deepEqual(dates('0 9 29 FEB *', '2026-01-01T00:00:00Z'), ['2028-02-29T09:00:00.000Z']);
  assert.deepEqual(dates('0 9 * * FRI#L', '2026-10-01T00:00:00Z'), ['2026-10-30T09:00:00.000Z']);
  assert.deepEqual(dates('0 9 15W * *', '2026-08-01T00:00:00Z'), ['2026-08-14T09:00:00.000Z']);
});

test('IANA timezone does not depend on host timezone; invalid timezone fails', () => {
  assert.deepEqual(dates('0 9 * * *', '2026-01-01T00:00:00Z', 1, 'Asia/Nicosia'), ['2026-01-01T07:00:00.000Z']);
  assert.deepEqual(dates('0 9 * * *', '2026-07-01T00:00:00Z', 1, 'Asia/Nicosia'), ['2026-07-01T06:00:00.000Z']);
  assert.throws(() => dates('0 9 * * *', '2026-01-01T00:00:00Z', 1, 'Mars/Phobos'));
});

test('DST forward: skip nonexistent local time (Nicosia and New York)', () => {
  assert.deepEqual(dates('30 3 * * *', '2026-03-28T23:00:00Z', 2, 'Asia/Nicosia'), ['2026-03-30T00:30:00.000Z', '2026-03-31T00:30:00.000Z']);
  assert.deepEqual(dates('30 2 * * *', '2026-03-08T05:00:00Z', 2, 'America/New_York'), ['2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z']);
});

test('DST backward: first occurrence only; no second occurrence after first', () => {
  assert.deepEqual(dates('30 3 * * *', '2026-10-24T23:00:00Z', 2, 'Asia/Nicosia'), ['2026-10-25T00:30:00.000Z', '2026-10-26T01:30:00.000Z']);
  for (const from of ['2026-10-25T00:45:00Z', '2026-10-25T01:05:00Z']) {
    assert.deepEqual(dates('30 3 * * *', from, 1, 'Asia/Nicosia'), ['2026-10-26T01:30:00.000Z']);
  }
  assert.deepEqual(dates('30 1 * * *', '2026-11-01T04:00:00Z', 2, 'America/New_York'), ['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
});

test('at: Date made from explicit Z/offset preserves the absolute instant', () => {
  const expected = '2030-10-07T12:00:00.000Z';
  for (const input of ['2030-10-07T12:00:00Z', '2030-10-07T15:00:00+03:00']) {
    const job = new Cron(new Date(input), { timezone: 'America/New_York', paused: true });
    try {
      assert.equal(job.getOnce().toISOString(), expected);
      assert.equal(job.nextRun(new Date('2030-10-06T00:00:00Z')).toISOString(), expected);
      assert.equal(job.nextRun(new Date('2030-10-08T00:00:00Z')), null);
    } finally { job.stop(); }
  }
  assert.throws(() => new Cron(new Date(NaN), { paused: true }));
});

test('at timer fires once; cron callback registers each minute without waiting for work', async t => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const registered = [];
  let once = 0;
  const at = new Cron(new Date(now + 1000), () => { once++; });
  const cron = new Cron('* * * * *', { timezone: 'UTC', mode: '5-part' }, () => { registered.push(Date.now()); });
  try {
    t.mock.timers.tick(1000); await flush();
    assert.equal(once, 1);
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(i === 0 ? 59000 : 60000); await flush(); }
    assert.equal(once, 1);
    assert.equal(at.nextRun(), null);
    assert.deepEqual(registered, [1, 2, 3, 4].map(n => now + n * 60000));
  } finally { at.stop(); cron.stop(); }
});

test('past at is not replayed by Croner; stop cancels future callbacks', async t => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  let calls = 0;
  const past = new Cron(new Date(now - 10000), () => { calls++; });
  const stopped = new Cron(new Date(now + 1000), () => { calls++; });
  stopped.stop();
  try {
    assert.equal(past.nextRun(), null);
    t.mock.timers.tick(120000); await flush();
    assert.equal(calls, 0);
  } finally { past.stop(); }
});

test('restart of library timer skips elapsed cron times instead of catch-up', async t => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  let calls = 0;
  const first = new Cron('* * * * *', { timezone: 'UTC', mode: '5-part' }, () => { calls++; });
  t.mock.timers.tick(60000); await flush();
  assert.equal(calls, 1);
  first.stop();
  t.mock.timers.tick(4 * 60000); await flush();
  const second = new Cron('* * * * *', { timezone: 'UTC', mode: '5-part' }, () => { calls++; });
  try {
    assert.equal(second.nextRun().toISOString(), '2030-01-01T00:06:00.000Z');
    assert.equal(calls, 1);
    t.mock.timers.tick(60000); await flush();
    assert.equal(calls, 2);
  } finally { second.stop(); }
});

test('unprotected async callback does not suppress later timer firings', async t => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const pending = [];
  let calls = 0;
  const cron = new Cron('* * * * *', { timezone: 'UTC', mode: '5-part', protect: false }, () => { calls++; return new Promise(resolve => pending.push(resolve)); });
  try {
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(60000); await flush(); }
    assert.equal(calls, 3);
  } finally { cron.stop(); pending.forEach(resolve => resolve()); await flush(); }
});
