import {setTimeout} from 'node:timers/promises';

export async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the expected runtime state.');
    await setTimeout(5);
  }
}
