import { describe, expect, it } from 'vitest';

import {
  platformSplitClaim,
  topContentClaim,
} from '../src/components/overview/card-claim';
import {
  buildTrendFacts,
  topContentForInsights,
} from '../src/lib/insights-inputs';
import { calculateReportSummary } from '../src/lib/report-summary';
import type { AnalyticsDataRow } from '../src/lib/report-types';
import { checkpointState, qualityStates } from '../src/lib/video-log-cells';
import {
  compareViewsDesc,
  formatViews,
  sumViews,
  viewsShare,
} from '../src/lib/views';

/**
 * KB-153. A Facebook row's `views` is null (migration 020): Facebook has
 * no single view. Every surface reads that as "not measured" — never 0, and
 * never in a rank, a share or a trend.
 */
describe('the views rules', () => {
  it('sorts not measured after every figure', () => {
    const rows = [{ views: null }, { views: 0 }, { views: 50 }];
    expect([...rows].sort(compareViewsDesc)).toEqual([
      { views: 50 },
      { views: 0 },
      { views: null },
    ]);
  });

  it('gives a not-measured part no share and adds nothing for it', () => {
    expect(viewsShare(null, 100)).toBeNull();
    expect(viewsShare(25, 100)).toBe(25);
    expect(sumViews([null, null])).toBeNull();
    expect(sumViews([null, 10])).toBe(10);
    expect(formatViews(null)).toBe('Not measured');
  });
});

describe('the video log', () => {
  const base = {
    publishedAt: '2025-01-01T00:00:00Z',
    matureAt: { 30: true },
    predatesIngestAt: { 30: false },
    ingestLagDays: 0,
    impressions: 0,
    ctr: 0,
    avgViewDurationSeconds: null,
    avgViewPercentage: null,
  };

  it('says a Facebook checkpoint is not measured, not 0', () => {
    expect(checkpointState({ ...base, viewsAtAge: { 30: null } }, 30)).toEqual({
      kind: 'not-measured',
    });
  });

  it('says a Facebook lifetime is not measured, not 0', () => {
    expect(
      qualityStates({ ...base, viewsAtAge: { 30: null }, lifetimeViews: null })
        .lifetimeViews,
    ).toEqual({ kind: 'none', reason: 'no-single-view' });
  });
});

describe('overview claims and insights', () => {
  it('leaves Facebook out of the split and the ranking', () => {
    expect(
      platformSplitClaim([
        { platform: 'youtube', views: 300 },
        { platform: 'facebook', views: null },
      ]).figure,
    ).toBe('100%');
    expect(
      topContentClaim([
        { title: 'Reel', views: null },
        { title: 'Long cut', views: 10 },
      ]).sentence,
    ).toContain('Long cut');
  });

  it('ranks no Facebook item by views and states no views trend for it', () => {
    expect(
      topContentForInsights([
        {
          publishId: 'fb',
          episodeTitle: 'Reel',
          publishTitle: 'Reel',
          platform: 'facebook',
          views: null,
          likes: 9,
          engagementRate: null,
        },
      ]),
    ).toBeUndefined();

    const facebook = {
      platform: 'facebook',
      views: null,
      likes: 10,
      comments: 1,
      shares: 1,
    };
    const facts = buildTrendFacts([facebook], [{ ...facebook, likes: 5 }]);
    expect(
      facts.filter((f) => f.platform === 'facebook').map((f) => f.metric),
    ).not.toContain('views');
    expect(facts.find((f) => f.metric === 'likes')?.platform).toBeDefined();
  });
});

describe('the report summary', () => {
  it('adds a Facebook row to likes, not to views, and gives it no views line', () => {
    const row = (platform: string, views: number | null): AnalyticsDataRow =>
      ({
        snapshotDate: '2026-09-01',
        platform,
        contentTitle: platform,
        projectName: 'p',
        views,
        likes: 5,
        comments: 0,
        shares: 0,
        watchTimeSeconds: null,
        subscribersGained: null,
        revenueCents: 0,
        retentionData: null,
        impressions: 0,
        ctr: 0,
        avgViewDurationSeconds: null,
      }) as AnalyticsDataRow;

    const summary = calculateReportSummary([
      row('youtube', 100),
      row('facebook', null),
    ]);

    expect(summary.totalViews).toBe(100);
    expect(summary.totalLikes).toBe(10);
    expect(summary.platformBreakdown).toEqual({ youtube: 100 });
  });
});
