import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cron } from 'croner';
const flush = () => new Promise(resolve => setImmediate(resolve));
const cases = [
  ['Asia/Nicosia', '30 3 * * *', '2026-03-28T23:00:00Z'],
  ['America/New_York', '30 2 * * *', '2026-03-08T05:00:00Z'],
  ['Asia/Nicosia', '30 3 * * *', '2026-10-25T00:45:00Z'],
  ['Asia/Nicosia', '30 3 * * *', '2026-10-25T01:05:00Z'],
];
for (const [timezone, pattern, from] of cases) {
  test(`DST diagnostic ${timezone} ${from}`, async t => {
    const now = Date.parse(from);
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const calls = [];
    const job = new Cron(pattern, { timezone, mode: '5-part' }, () => calls.push(new Date().toISOString()));
    try {
      const next = job.nextRun()?.toISOString();
      // Advance in small increments, including both sides of each DST transition.
      for (let i = 0; i < 27 * 120; i++) { t.mock.timers.tick(30000); await flush(); }
      console.log(JSON.stringify({ timezone, pattern, from, next, count: calls.length, first: calls[0], last: calls.at(-1) }));
      if (from.startsWith('2026-10-25')) {
        assert.deepEqual(calls, ['2026-10-26T01:30:00.000Z'], 'No repeated callbacks during the second local hour');
      }
    } finally { job.stop(); }
  });
}
test('real-clock one-shot and cancellation', async () => {
  let cancelledCalls = 0;
  const cancelled = new Cron(new Date(Date.now() + 300), () => { cancelledCalls++; });
  cancelled.stop();
  let job;
  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => { job?.stop(); reject(new Error('Real timer did not fire within 5s')); }, 5000);
    job = new Cron(new Date(Date.now() + 1100), () => { clearTimeout(guard); resolve(); });
  });
  job.stop();
  if (cancelledCalls !== 0) throw new Error('Stopped timer fired');
});
