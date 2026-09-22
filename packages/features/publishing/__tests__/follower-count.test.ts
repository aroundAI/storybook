import { describe, expect, it } from 'vitest';

import { describeFollowerCount } from '../src/lib/follower-count';

// Every case pins `today`: the freshness rule compares `asOf` to the wall
// clock, so a case that omits it goes red once the calendar moves 7 days past
// its `asOf` — which is how this file broke every PR's CI on 2026-09-22.
describe('describeFollowerCount', () => {
  it('dates a measured level without marking it stale', () => {
    expect(
      describeFollowerCount({
        count: 41_000,
        source: 'snapshot',
        asOf: '2026-09-15',
        today: '2026-09-16',
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
        today: '2026-09-16',
      }).detail,
    ).toBe(
      '1,200 followers — Reconstructed from daily movement, no snapshot that day, as of Sep 15, 2026',
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

  // A rounded-down count must not read as exact, on any surface.
  it('discloses the platform rounding in the detail', () => {
    const rounded = describeFollowerCount({
      count: 42_600,
      source: 'snapshot',
      asOf: '2026-09-14',
      today: '2026-09-15',
      roundingStep: 100,
    });

    expect(rounded.detail).toContain('off by up to 99 either way');
    expect(rounded.detail).not.toContain('higher');
    expect(rounded.short).toBe('42.6K');

    expect(
      describeFollowerCount({
        count: 900,
        source: 'snapshot',
        asOf: '2026-09-14',
        today: '2026-09-15',
        roundingStep: 0,
      }).detail,
    ).not.toContain('either way');
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

  // A measured count ages too: a disconnected channel, or one whose capture
  // broke, keeps its last level for up to 400 days of lookback.
  describe('age', () => {
    const today = '2026-09-18';

    it('leaves a recent measured count unmarked', () => {
      const recent = describeFollowerCount({
        count: 41_000,
        source: 'snapshot',
        asOf: '2026-09-15',
        today,
      });

      expect(recent.stale).toBe(false);
      expect(recent.short).toBe('41.0K');
    });

    it('marks and dates a measured count a month old', () => {
      const old = describeFollowerCount({
        count: 2_500,
        source: 'reconstructed',
        asOf: '2026-08-19',
        today,
      });

      expect(old.stale).toBe(true);
      expect(old.short).toBe('2.5K · Aug 19, 2026');
      expect(old.detail).toContain('no newer data since');
    });

    it('keeps a week-old count fresh and an eight-day-old one stale', () => {
      const at = (asOf: string) =>
        describeFollowerCount({ count: 1, source: 'snapshot', asOf, today })
          .stale;

      expect(at('2026-09-11')).toBe(false);
      expect(at('2026-09-10')).toBe(true);
    });

    it('marks a stored count whatever its date', () => {
      expect(
        describeFollowerCount({
          count: 900,
          source: 'metadata',
          asOf: '2026-09-18',
          today,
        }).stale,
      ).toBe(true);
    });
  });
});
