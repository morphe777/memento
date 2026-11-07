// H-15: `MEMENTO_TEST_NOW=2027-01-01T00:00:00Z pnpm test` runs the whole suite as if it were that moment (only
// Date is faked: timers run normally). The suite must pass whatever the day and the order (`--sequence.shuffle`).
import { vi } from 'vitest';

const at = process.env.MEMENTO_TEST_NOW;
if (at) {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(at), shouldAdvanceTime: true });
}
