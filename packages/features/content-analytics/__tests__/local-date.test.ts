import { describe, expect, it } from 'vitest';

import { localDateOf } from '../src/lib/local-date';

// The time-zone behaviour is proved in a browser set to Asia/Kolkata
// (apps/e2e/tests/experiments/change-log-details.spec.ts); a unit test in
// the runner's own zone could only restate the implementation.
describe('localDateOf', () => {
  it('zero-pads month and day', () => {
    expect(localDateOf(new Date(2026, 2, 5, 12))).toBe('2026-03-05');
  });
});
