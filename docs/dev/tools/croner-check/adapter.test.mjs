import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cron } from 'croner';
import { nextRun, nextRuns, scheduleCron } from './zoned-cron.mjs';

function nextDates(pattern, timezone, from, count = 1) {
  return nextRuns(pattern, timezone, new Date(from), count).map(d => d.toISOString());
}
const iso = value => new Date(value).toISOString();
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const [zone, pattern, from, expected] of [
  ['Asia/Nicosia', '30 3 * * *', '2026-03-28T23:00Z', ['2026-03-30T00:30Z', '2026-03-31T00:30Z']],
  ['America/New_York', '30 2 * * *', '2026-03-08T05:00Z', ['2026-03-09T06:30Z', '2026-03-10T06:30Z']],
  ['Asia/Nicosia', '30 3 * * *', '2026-10-24T23:00Z', ['2026-10-25T00:30Z', '2026-10-26T01:30Z']],
  ['Asia/Nicosia', '30 3 * * *', '2026-10-25T00:45Z', ['2026-10-26T01:30Z']],
  ['Asia/Nicosia', '30 3 * * *', '2026-10-25T01:05Z', ['2026-10-26T01:30Z']],
  ['America/New_York', '30 1 * * *', '2026-11-01T04:00Z', ['2026-11-01T05:30Z', '2026-11-02T06:30Z']],
  ['America/New_York', '30 1 * * *', '2026-11-01T06:05Z', ['2026-11-02T06:30Z']],
  ['Australia/Lord_Howe', '15 2 * * *', '2026-10-03T14:00Z', ['2026-10-04T15:15Z', '2026-10-05T15:15Z']],
  ['Australia/Lord_Howe', '45 1 * * *', '2026-04-04T13:00Z', ['2026-04-04T14:45Z', '2026-04-05T15:15Z']],
  ['Australia/Lord_Howe', '45 1 * * *', '2026-04-04T15:05Z', ['2026-04-05T15:15Z']],
  ['Pacific/Apia', '0 9 * * *', '2011-12-29T18:59Z', ['2011-12-29T19:00Z', '2011-12-30T19:00Z']],
]) {
  test(`${zone}: ${pattern} from ${from}`, () => {
    assert.deepEqual(nextDates(pattern, zone, from, expected.length), expected.map(iso));
  });
}

test('every minute skips spring gap without losing the first existing minute', () => {
  assert.deepEqual(nextDates('* * * * *', 'Asia/Nicosia', '2026-03-29T00:58Z', 3),
    ['2026-03-29T00:59Z', '2026-03-29T01:00Z', '2026-03-29T01:01Z'].map(iso));
});
test('every minute runs the repeated local minutes only at their first occurrence', () => {
  assert.deepEqual(nextDates('* * * * *', 'Asia/Nicosia', '2026-10-25T00:58Z', 3),
    ['2026-10-25T00:59Z', '2026-10-25T02:00Z', '2026-10-25T02:01Z'].map(iso));
  assert.deepEqual(nextDates('* * * * *', 'Asia/Nicosia', '2026-10-25T01:05Z', 2),
    ['2026-10-25T02:00Z', '2026-10-25T02:01Z'].map(iso));
});
test('half-hour overlap and gap with minute schedule', () => {
  assert.deepEqual(nextDates('* * * * *', 'Australia/Lord_Howe', '2026-04-04T14:58Z', 3),
    ['2026-04-04T14:59Z', '2026-04-04T15:30Z', '2026-04-04T15:31Z'].map(iso));
  assert.deepEqual(nextDates('* * * * *', 'Australia/Lord_Howe', '2026-10-03T15:28Z', 3),
    ['2026-10-03T15:29Z', '2026-10-03T15:30Z', '2026-10-03T15:31Z'].map(iso));
});
test('calendar syntax is preserved', () => {
  assert.deepEqual(nextDates('0 9 1 * MON', 'UTC', '2026-09-30T10:00Z', 3), ['2026-10-01T09:00Z', '2026-10-05T09:00Z', '2026-10-12T09:00Z'].map(iso));
  assert.deepEqual(nextDates('0 9 1 * +MON', 'UTC', '2026-09-30T10:00Z', 2), ['2027-02-01T09:00Z', '2027-03-01T09:00Z'].map(iso));
  for (const [pattern, from, expected] of [
    ['0 9 L * *', '2026-02-01T00:00Z', '2026-02-28T09:00Z'],
    ['0 9 * * MON#2', '2026-10-01T00:00Z', '2026-10-12T09:00Z'],
    ['0 9 * * FRI#L', '2026-10-01T00:00Z', '2026-10-30T09:00Z'],
    ['0 9 15W * *', '2026-08-01T00:00Z', '2026-08-14T09:00Z'],
    ['0 9 29 FEB *', '2026-01-01T00:00Z', '2028-02-29T09:00Z'],
    ['*/15 9-10 * * MON-FRI', '2026-10-09T10:46Z', '2026-10-12T09:00Z'],
  ]) assert.deepEqual(nextDates(pattern, 'UTC', from), [iso(expected)]);
});
test('ordinary timezone and exact boundary', () => {
  assert.deepEqual(nextDates('0 9 * * *', 'Asia/Nicosia', '2026-01-01T00:00Z'), [iso('2026-01-01T07:00Z')]);
  assert.deepEqual(nextDates('0 9 * * *', 'Asia/Nicosia', '2026-07-01T00:00Z'), [iso('2026-07-01T06:00Z')]);
  assert.deepEqual(nextDates('* * * * *', 'Asia/Kathmandu', '2026-01-01T00:00:00.500Z'), [iso('2026-01-01T00:01Z')]);
  assert.deepEqual(nextDates('30 3 * * *', 'Asia/Nicosia', '2026-10-25T00:30Z'), [iso('2026-10-26T01:30Z')]);
});

// Independent oracle: walk real UTC minutes, read wall time through Intl,
// and remember the first occurrence of each local minute. No Temporal mapping.
function expectedInWindow(pattern, timezone, from, minutes) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const matcher = new Cron(pattern, { timezone: 'UTC', mode: '5-part', paused: true });
  const seen = new Set();
  const result = [];
  try {
    for (let i = 0; i <= minutes; i++) {
      const ms = Date.parse(from) + i * 60000;
      const parts = Object.fromEntries(fmt.formatToParts(ms).map(p => [p.type, p.value]));
      const key = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`;
      if (!seen.has(key) && i > 0 && matcher.match(new Date(key))) result.push(new Date(ms).toISOString());
      seen.add(key);
    }
    return result;
  } finally { matcher.stop(); }
}
for (const [timezone, from, minutes] of [
  ['Asia/Nicosia', '2026-03-28T23:00Z', 300],
  ['Asia/Nicosia', '2026-10-24T23:00Z', 300],
  ['America/New_York', '2026-03-08T05:00Z', 300],
  ['America/New_York', '2026-11-01T04:00Z', 300],
  ['Australia/Lord_Howe', '2026-10-03T13:30Z', 240],
  ['Australia/Lord_Howe', '2026-04-04T13:00Z', 240],
  ['Pacific/Apia', '2011-12-29T08:00Z', 3000],
]) {
  test(`UTC-minute oracle ${timezone} ${from}`, () => {
    for (const pattern of ['* * * * *', '*/15 * * * *', '30 3 * * *']) {
      const expected = expectedInWindow(pattern, timezone, from, minutes);
      const actual = nextDates(pattern, timezone, from, expected.length + 1);
      assert.deepEqual(actual.slice(0, -1), expected, pattern);
      assert.ok(Date.parse(actual.at(-1)) > Date.parse(from) + minutes * 60000, pattern);
    }
  });
}

for (const [timezone, pattern, from, minutes] of [
  ['Asia/Nicosia', '30 3 * * *', '2026-10-24T23:00Z', 300],
  ['Asia/Nicosia', '* * * * *', '2026-10-24T23:00Z', 300],
  ['Asia/Nicosia', '30 3 * * *', '2026-03-28T23:00Z', 300],
  ['Asia/Nicosia', '* * * * *', '2026-03-28T23:00Z', 300],
  ['America/New_York', '30 1 * * *', '2026-11-01T04:00Z', 300],
  ['America/New_York', '30 2 * * *', '2026-03-08T05:00Z', 300],
  ['Australia/Lord_Howe', '* * * * *', '2026-04-04T13:00Z', 240],
  ['Australia/Lord_Howe', '* * * * *', '2026-10-03T13:30Z', 240],
]) {
  test(`timer ${timezone} ${pattern} ${from}`, async t => {
    const expected = expectedInWindow(pattern, timezone, from, minutes);
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse(from) });
    const actual = [];
    const errors = [];
    const timer = scheduleCron(pattern, timezone, scheduledAt => {
      assert.equal(scheduledAt.getTime(), Date.now());
      actual.push(scheduledAt.toISOString());
    }, error => errors.push(error));
    try {
      for (let i = 0; i < minutes * 2; i++) { t.mock.timers.tick(30000); await flush(); }
      assert.deepEqual(errors, []);
      assert.deepEqual(actual, expected);
      assert.ok(timer.nextRun().getTime() > Date.now());
    } finally { timer.stop(); }
  });
}

test('restart during fold does not replay first occurrence or emit false callbacks', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-25T01:05Z') });
  const actual = [];
  const timer = scheduleCron('30 3 * * *', 'Asia/Nicosia', d => actual.push(d.toISOString()), e => { throw e; });
  try {
    assert.equal(timer.nextRun().toISOString(), iso('2026-10-26T01:30Z'));
    for (let i = 0; i < 3000; i++) { t.mock.timers.tick(30000); await flush(); }
    assert.deepEqual(actual, [iso('2026-10-26T01:30Z')]);
  } finally { timer.stop(); }
});
test('stop cancels timer, including stop called from callback', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2030-01-01T00:00Z') });
  let calls = 0;
  const timer = scheduleCron('* * * * *', 'UTC', () => { calls++; timer.stop(); }, e => { throw e; });
  t.mock.timers.tick(60000); await flush();
  t.mock.timers.tick(120000); await flush();
  assert.equal(calls, 1);
  assert.equal(timer.nextRun(), null);
});
test('pending async callback does not prevent next occurrence', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2030-01-01T00:00Z') });
  const pending = [];
  let calls = 0;
  const timer = scheduleCron('* * * * *', 'UTC', () => { calls++; return new Promise(resolve => pending.push(resolve)); }, e => { throw e; });
  try {
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(60000); await flush(); }
    assert.equal(calls, 3);
  } finally { timer.stop(); pending.forEach(resolve => resolve()); await flush(); }
});
test('callback error is reported and stops future scheduling', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2030-01-01T00:00Z') });
  const errors = [];
  const timer = scheduleCron('* * * * *', 'UTC', () => { throw new Error('enqueue failed'); }, e => errors.push(e.message));
  t.mock.timers.tick(60000); await flush();
  assert.deepEqual(errors, ['enqueue failed']);
  assert.equal(timer.nextRun(), null);
});
test('validation fails explicitly', () => {
  for (const p of ['* * * * * *', '@daily', '60 * * * *', '0 25 * * *', '*/0 * * * *']) assert.throws(() => nextRun(p, 'UTC', new Date()));
  assert.throws(() => nextRun('* * * * *', 'Mars/Phobos', new Date()));
  assert.throws(() => nextRun('* * * * *', 'UTC', new Date(NaN)));
  assert.throws(() => nextRuns('* * * * *', 'UTC', new Date(), -1));
});

test('recreating timer after downtime skips missed occurrences', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2030-01-01T00:00Z') });
  const actual = [];
  const first = scheduleCron('* * * * *', 'UTC', d => actual.push(d.toISOString()), e => { throw e; });
  t.mock.timers.tick(60000); await flush();
  first.stop();
  t.mock.timers.tick(4 * 60000); await flush();
  const second = scheduleCron('* * * * *', 'UTC', d => actual.push(d.toISOString()), e => { throw e; });
  try {
    assert.equal(second.nextRun().toISOString(), iso('2030-01-01T00:06Z'));
    t.mock.timers.tick(60000); await flush();
    assert.deepEqual(actual, ['2030-01-01T00:01Z', '2030-01-01T00:06Z'].map(iso));
  } finally { second.stop(); }
});
test('at in UTC preserves the second overlap instant and fires only once', async t => {
  const start = Date.parse('2026-10-25T01:00Z');
  const target = Date.parse('2026-10-25T01:30Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  const actual = [];
  const timer = new Cron(new Date(target), { timezone: 'UTC', maxRuns: 1 }, () => actual.push(Date.now()));
  try {
    assert.equal(timer.nextRun().getTime(), target);
    for (let i = 0; i < 240; i++) { t.mock.timers.tick(30000); await flush(); }
    assert.deepEqual(actual, [target]);
  } finally { timer.stop(); }
});
