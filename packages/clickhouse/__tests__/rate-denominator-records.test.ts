import { describe, expect, it } from 'vitest';

import {
  computeMeasure,
  denominatorSentence,
  lifetimeWindow,
  recordViewsDenominator,
  recordedEngagementRatePercent,
  recordedLikesAndCommentsPercent,
  rpmCents,
} from '../src/lib/measures';
import { pooledRpmCents } from '../src/lib/segment-stats';

/** FILM-1732: every rate over views carries the record of what it divided by. */

const ids = (definitions: readonly { id: string }[]) =>
  definitions.map(({ id }) => id);

describe('recordViewsDenominator (FILM-1732)', () => {
  it('records one definition for a YouTube window wholly after 2026-08-27', () => {
    const record = recordViewsDenominator({
      platforms: ['youtube'],
      window: { from: '2026-09-01', to: '2026-10-01' },
    });

    expect(record.column).toBe('views');
    expect(record.role).toBe('preferred');
    expect(record.window).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(record.platforms).toHaveLength(1);
    expect(ids(record.definitions)).toEqual(['youtube.views.2026-08-27']);
    expect(record.crosses).toEqual([]);
  });

  it('records both definitions and the change for a window spanning 2026-08-27', () => {
    const record = recordViewsDenominator({
      platforms: ['youtube'],
      window: { from: '2026-08-01', to: '2026-09-15' },
    });

    expect(ids(record.definitions)).toEqual([
      'youtube.views.legacy',
      'youtube.views.shorts.2025-03-31',
      'youtube.views.2026-08-27',
    ]);
    expect(record.crosses).toHaveLength(1);
    expect(record.crosses[0]!.date).toBe('2026-08-27');
    expect(record.crosses[0]!.from.id).toBe('youtube.views.legacy');
    expect(record.crosses[0]!.to.id).toBe('youtube.views.2026-08-27');
  });

  it('records the Shorts change of 2025-03-31 for a window across it', () => {
    const record = recordViewsDenominator({
      platforms: ['youtube'],
      window: { from: '2025-03-01', to: '2025-04-30' },
    });

    expect(ids(record.definitions)).toEqual([
      'youtube.views.legacy',
      'youtube.views.shorts.2025-03-31',
    ]);
    expect(record.crosses.map((change) => change.date)).toEqual(['2025-03-31']);
  });

  it('records an undated definition (TikTok) without inventing a date', () => {
    const record = recordViewsDenominator({
      platforms: ['tiktok'],
      window: { from: '2026-01-01', to: '2026-10-01' },
    });

    expect(ids(record.definitions)).toEqual(['tiktok.display.view_count']);
    expect(record.definitions[0]!.effectiveFrom).toBeNull();
    expect(record.crosses).toEqual([]);
  });

  it('records Facebook as not in the denominator, never with a definition', () => {
    const record = recordViewsDenominator({
      platforms: ['facebook'],
      window: { from: '2026-09-01', to: '2026-10-01' },
    });

    expect(record.platforms).toEqual([
      {
        platform: 'facebook',
        inDenominator: false,
        reason: 'no_single_view_definition',
      },
    ]);
    expect(record.definitions).toEqual([]);
  });

  it('records each pooled platform once, in registry order, ignoring non-platforms', () => {
    const record = recordViewsDenominator({
      platforms: ['facebook', 'instagram', 'youtube', 'youtube', 'manual'],
      window: { from: '2026-08-01', to: '2026-09-15' },
    });

    expect(record.platforms.map((part) => part.platform)).toEqual([
      'youtube',
      'instagram',
      'facebook',
    ]);
    expect(record.platforms.map((part) => part.inDenominator)).toEqual([
      true,
      true,
      false,
    ]);
    // Instagram's rates prefer reach, which is not ingested (FILM-1712).
    expect(record.role).toBe('fallback');
    expect(record.fallbackFor).toEqual({
      preferred: 'reach',
      because: 'not_ingested',
    });
    expect(record.crosses.map((change) => change.to.platform)).toEqual([
      'youtube',
    ]);
  });
});

describe('lifetimeWindow (FILM-1732)', () => {
  const readOn = new Date('2026-10-02T12:00:00Z');

  it('covers the earliest publish to the read date', () => {
    expect(
      lifetimeWindow(
        ['2026-05-04T10:00:00Z', null, '2026-03-02T08:00:00Z'],
        readOn,
      ),
    ).toEqual({ from: '2026-03-02', to: '2026-10-02' });
  });

  it('is the read date alone when nothing has a publish date', () => {
    expect(lifetimeWindow([null, undefined], readOn)).toEqual({
      from: '2026-10-02',
      to: '2026-10-02',
    });
  });
});

describe('denominatorSentence (FILM-1732)', () => {
  it('names the window, each definition with its start, and the crossing', () => {
    const sentence = denominatorSentence(
      recordViewsDenominator({
        platforms: ['youtube', 'facebook'],
        window: { from: '2026-08-01', to: '2026-09-15' },
      }),
    );

    expect(sentence).toContain(
      'Divided by views, counted from 1 Aug 2026 to 15 Sep 2026.',
    );
    expect(sentence).toContain('View (before unified counting)');
    expect(sentence).toContain(
      'View (from the moment playback begins, autoplay included), since 27 Aug 2026',
    );
    expect(sentence).toContain(
      'YouTube changed what a view is on 27 Aug 2026, inside this window',
    );
    expect(sentence).toContain(
      'Facebook is not in the denominator: it reports no single view.',
    );
  });

  it('names no change for a window wholly after it', () => {
    const sentence = denominatorSentence(
      recordViewsDenominator({
        platforms: ['youtube'],
        window: { from: '2026-09-01', to: '2026-10-01' },
      }),
    );

    expect(sentence).not.toContain('changed what a view is');
    expect(sentence).not.toContain('before unified counting');
  });
});

describe('recorded rates keep their figures (FILM-1732)', () => {
  const record = recordViewsDenominator({
    platforms: ['youtube'],
    window: { from: '2026-09-01', to: '2026-10-01' },
  });

  it('engagement rate is the displayed figure, record attached', () => {
    expect(
      recordedEngagementRatePercent(
        { views: 1000, likes: 50, comments: 30, shares: 20 },
        record,
      ),
    ).toEqual({ value: 10, denominator: record });
    expect(
      recordedEngagementRatePercent(
        { views: 0, likes: 5, comments: 0, shares: 0 },
        record,
      ).value,
    ).toBe(0);
  });

  it('likes and comments per view leaves shares out, as the two cards always did (KB-171)', () => {
    expect(
      recordedLikesAndCommentsPercent(
        { views: 1000, likes: 50, comments: 30 },
        record,
      ).value,
    ).toBe(8);
  });

  it('RPM is cents per thousand views, null without views', () => {
    expect(rpmCents(500, 2000)).toBe(250);
    expect(rpmCents(500, 0)).toBeNull();
    expect(pooledRpmCents(500, 2000)).toBe(250);
    expect(pooledRpmCents(500, 0)).toBeNull();
  });
});

describe('computeMeasure carries the same record shape (FILM-1732)', () => {
  it('stamps window, platform and no crossing on a views measure', () => {
    const measure = computeMeasure('engagement_rate', {
      platform: 'youtube',
      from: '2026-09-01',
      to: '2026-10-01',
      counts: {
        views: 100,
        likes: 5,
        comments: 3,
        shares: 2,
        saves: 0,
        subscribers_gained: 0,
      },
    });

    expect(measure.kind).toBe('value');
    if (measure.kind !== 'value') return;
    expect(measure.denominator.window).toEqual({
      from: '2026-09-01',
      to: '2026-10-01',
    });
    expect(measure.denominator.platforms).toEqual([
      {
        platform: 'youtube',
        inDenominator: true,
        definitions: measure.denominator.definitions,
      },
    ]);
    expect(measure.denominator.crosses).toEqual([]);
  });
});
