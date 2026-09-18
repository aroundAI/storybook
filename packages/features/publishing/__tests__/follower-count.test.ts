import { describe, expect, it } from 'vitest';

import { describeFollowerCount } from '../src/lib/follower-count';

describe('describeFollowerCount', () => {
  it('dates a measured level without marking it stale', () => {
    expect(
      describeFollowerCount({
        count: 41_000,
        source: 'snapshot',
        asOf: '2026-09-15',
      }),
    ).toEqual({
      short: '41.0K',
      detail: '41,000 followers — Measured, as of Sep 15, 2026',
      stale: false,
    });
  });

  it('says a reconstructed level is reconstructed', () => {
    expect(
      describeFollowerCount({
        count: 1200,
        source: 'reconstructed',
        asOf: '2026-09-15',
      }).detail,
    ).toBe(
      '1,200 followers — Reconstructed from daily movement, as of Sep 15, 2026',
    );
  });

  // A stored count must not read as current, even in the short form.
  it('puts the connection date on a stored count', () => {
    expect(
      describeFollowerCount({
        count: 900,
        source: 'metadata',
        asOf: '2026-03-04',
      }),
    ).toEqual({
      short: '900 · Mar 4, 2026',
      detail:
        '900 followers — Stored when the account was connected, not live, as of Mar 4, 2026',
      stale: true,
    });
  });

  // Read in UTC: a local-time parse would print Mar 3 west of Greenwich.
  it('does not shift the date by the viewer’s time zone', () => {
    expect(
      describeFollowerCount({
        count: 1,
        source: 'snapshot',
        asOf: '2026-03-04',
      }).detail,
    ).toContain('Mar 4, 2026');
  });
});
