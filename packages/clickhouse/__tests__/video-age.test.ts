import { describe, expect, it } from 'vitest';

import {
  checkpointPredatesIngest,
  computeIngestLagDays,
  computeMaturity,
  daysBetween,
} from '../src/lib/video-age';

const CHECKPOINTS = [30, 90, 180, 365];
const NOW = new Date('2026-06-01T12:00:00Z');

describe('daysBetween', () => {
  it('counts whole elapsed days', () => {
    expect(
      daysBetween(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-31T00:00:00Z'),
      ),
    ).toBe(30);
  });

  it('floors a partial day rather than rounding up', () => {
    expect(
      daysBetween(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-02T23:59:00Z'),
      ),
    ).toBe(1);
  });

  it('is negative when the second instant precedes the first', () => {
    expect(
      daysBetween(
        new Date('2026-01-10T00:00:00Z'),
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toBe(-9);
  });
});

describe('computeMaturity', () => {
  it('marks a checkpoint reached exactly on the boundary day', () => {
    // Days 0..29 count toward @30d, so the checkpoint is reached at day 30.
    const publishedAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

    expect(computeMaturity(publishedAt, CHECKPOINTS, NOW)[30]).toBe(true);
  });

  it('marks the day before the boundary as not yet reached', () => {
    const publishedAt = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);

    expect(computeMaturity(publishedAt, CHECKPOINTS, NOW)[30]).toBe(false);
  });

  it('distinguishes reached from unreached checkpoints on one video', () => {
    // 100 days old: @30 and @90 are real, @180 and @365 are not yet.
    const publishedAt = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000);
    const mature = computeMaturity(publishedAt, CHECKPOINTS, NOW);

    expect(mature).toEqual({ 30: true, 90: true, 180: false, 365: false });
  });

  it('treats a video published today as mature for nothing', () => {
    const mature = computeMaturity(NOW, CHECKPOINTS, NOW);

    expect(Object.values(mature).every((v) => v === false)).toBe(true);
  });

  it('treats a future publication date as mature for nothing', () => {
    const publishedAt = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);
    const mature = computeMaturity(publishedAt, CHECKPOINTS, NOW);

    expect(Object.values(mature).every((v) => v === false)).toBe(true);
  });

  it('accepts an ISO string', () => {
    expect(computeMaturity('2026-01-01T00:00:00Z', [30], NOW)[30]).toBe(true);
  });

  it('reports nothing mature for an unparseable date rather than throwing', () => {
    expect(computeMaturity('not-a-date', CHECKPOINTS, NOW)[30]).toBe(false);
  });
});

describe('computeIngestLagDays', () => {
  it('is zero when metrics start on the publication day', () => {
    expect(computeIngestLagDays('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('counts the gap when ingest started late', () => {
    expect(computeIngestLagDays('2026-01-01', '2026-03-15')).toBe(73);
  });

  it('is null when nothing has been ingested', () => {
    // Distinct from a lag of zero: "no rows" is not "ingested promptly".
    expect(computeIngestLagDays('2026-01-01', null)).toBeNull();
    expect(computeIngestLagDays('2026-01-01', undefined)).toBeNull();
  });

  it('clamps a metric day before publication to zero', () => {
    expect(computeIngestLagDays('2026-01-10', '2026-01-01')).toBe(0);
  });

  it('is null for an unparseable date', () => {
    expect(computeIngestLagDays('nope', '2026-01-01')).toBeNull();
  });
});

describe('checkpointPredatesIngest', () => {
  it('treats a one-day lag as normal', () => {
    // Metrics landing the day after publication is the expected case.
    expect(checkpointPredatesIngest(1, 30)).toBe(false);
  });

  it('flags a window that closed before the first metric arrived', () => {
    // 45-day lag: the whole @30d window has no data in it.
    expect(checkpointPredatesIngest(45, 30)).toBe(true);
  });

  it('flags a window ending exactly on the first metric day', () => {
    expect(checkpointPredatesIngest(30, 30)).toBe(true);
  });

  it('does not flag a window that outlives the lag', () => {
    // @365d is missing its first 45 days but is still broadly meaningful,
    // unlike @30d at the same lag.
    expect(checkpointPredatesIngest(45, 365)).toBe(false);
  });

  it('does not flag when nothing was ingested', () => {
    // "No rows at all" is a different statement from "ingested late", and
    // the caller distinguishes them via a null ingestLagDays.
    expect(checkpointPredatesIngest(null, 30)).toBe(false);
  });
});

describe('timezone independence', () => {
  // The two values arrive in different formats and neither carries a zone:
  // published_at as toString(DateTime) -> 'YYYY-MM-DD HH:MM:SS', which V8
  // parses as LOCAL, and first_metric_date as toString(Date) ->
  // 'YYYY-MM-DD', which V8 parses as UTC. Mixing them skews the difference
  // by the host offset, and Math.floor turns that into an off-by-one at
  // exactly the boundaries this module exists to get right.
  it('measures ingest lag in UTC regardless of host timezone', () => {
    expect(computeIngestLagDays('2026-05-15 00:00:00', '2026-05-16')).toBe(1);
  });

  it('does not let the host offset move a maturity boundary', () => {
    // Published exactly 30 days before `now`, in the query's own format.
    expect(
      computeMaturity(
        '2026-05-15 00:00:00',
        [30],
        new Date('2026-06-14T00:00:00Z'),
      )[30],
    ).toBe(true);

    // One day short must still be short.
    expect(
      computeMaturity(
        '2026-05-16 00:00:00',
        [30],
        new Date('2026-06-14T00:00:00Z'),
      )[30],
    ).toBe(false);
  });

  it('accepts an explicit zone without double-applying it', () => {
    expect(computeIngestLagDays('2026-05-15T00:00:00Z', '2026-05-16')).toBe(1);
  });
});
