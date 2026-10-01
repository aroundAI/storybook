import { describe, expect, it } from 'vitest';

import type { FacebookInsightsResult } from '../src/providers/facebook/types';
import {
  buildFacebookRetentionPoints,
  buildSnapshotDeltaRow,
  computeSnapshotDelta,
  facebookCumulativeTotals,
} from '../src/server/ingest';

/**
 * FILM-1720. A Facebook row holds no `views` — four kinds of view, none of
 * them YouTube's (FILM-1722) — and each kind keeps its own column, the
 * organic/paid and autoplay/click splits included.
 */

function reel(
  overrides: Partial<FacebookInsightsResult['totals']> = {},
): FacebookInsightsResult {
  return {
    videoId: 'v1',
    postId: 'page_v1',
    totals: {
      reactions: 40,
      comments: 6,
      shares: 3,
      mediaViews: 2400,
      uniqueViewers: 1300,
      firstPlays: 1800,
      replayCount: 300,
      threeSecondViews: 1000,
      threeSecondViewsOrganic: 850,
      threeSecondViewsPaid: 150,
      threeSecondViewsAutoplayed: 700,
      threeSecondViewsClickedToPlay: 300,
      fifteenSecondViews: 350,
      completeViews: 200,
      viewTimeMs: 125_400,
      follows: 9,
      ...overrides,
    },
    retention: null,
  };
}

describe('facebookCumulativeTotals', () => {
  it('names no views, and keeps every denominator apart', () => {
    const totals = facebookCumulativeTotals(reel());

    expect(totals.views).toBeNull();
    expect(totals).toMatchObject({
      likes: 40,
      comments: 6,
      shares: 3,
      saves: null,
      // 125,400 ms of watching.
      watch_time_seconds: 125,
      subscribers_gained: 9,
      accounts_reached: 1300,
      reposts: null,
    });
    expect(totals.denominators).toEqual({
      media_views: 2400,
      plays: 1800,
      replays: 300,
      views_3s: 1000,
      views_3s_organic: 850,
      views_3s_paid: 150,
      views_3s_autoplayed: 700,
      views_3s_clicked_to_play: 300,
      views_15s: 350,
      complete_views: 200,
    });
  });

  it('leaves a Reels-only figure null on a video in the player', () => {
    const totals = facebookCumulativeTotals(
      reel({ firstPlays: null, replayCount: null, follows: null }),
    );

    expect(totals.subscribers_gained).toBeNull();
    expect(totals.denominators).toMatchObject({ plays: null, replays: null });
  });
});

describe('a Facebook day row', () => {
  const yesterday = {
    snapshot_date: '2026-09-30',
    views: null,
    likes: 30,
    comments: 4,
    shares: 1,
    saves: null,
    watch_time_seconds: 100,
    subscribers_gained: 5,
    accounts_reached: 1000,
    reposts: null,
    all_surface_views: null,
    all_surface_likes: null,
    all_surface_comments: null,
    media_views: 2000,
    plays: 1500,
    replays: 200,
    views_3s: 800,
    views_3s_organic: 700,
    views_3s_paid: 100,
    views_3s_autoplayed: 600,
    views_3s_clicked_to_play: 200,
    views_15s: 300,
    complete_views: 150,
  };

  it('is the day’s increase in each denominator, with views NULL', () => {
    const row = buildSnapshotDeltaRow({
      projectId: 'proj',
      videoId: 'pub',
      platform: 'facebook',
      metricDate: '2026-10-01',
      delta: computeSnapshotDelta(facebookCumulativeTotals(reel()), yesterday),
    });

    expect(row).toMatchObject({
      platform: 'facebook',
      views: null,
      likes: 10,
      comments: 2,
      shares: 2,
      watch_time_seconds: 25,
      subscribers_gained: 4,
      accounts_reached: 300,
      media_views: 400,
      plays: 300,
      replays: 100,
      views_3s: 200,
      // The split is kept, not summed: 150 organic and 50 paid.
      views_3s_organic: 150,
      views_3s_paid: 50,
      views_3s_autoplayed: 100,
      views_3s_clicked_to_play: 100,
      views_15s: 50,
      complete_views: 50,
      metric_source: 'snapshot_delta',
    });
    expect(row).not.toHaveProperty('denominators');
  });

  it('is null, not the lifetime, where yesterday measured nothing', () => {
    const row = buildSnapshotDeltaRow({
      projectId: 'proj',
      videoId: 'pub',
      platform: 'facebook',
      metricDate: '2026-10-01',
      delta: computeSnapshotDelta(facebookCumulativeTotals(reel()), {
        ...yesterday,
        plays: null,
      }),
    });

    expect(row).toMatchObject({ plays: null, views_3s: 200 });
  });

  it('refuses a TikTok or Instagram row without views, rather than writing 0', () => {
    const delta = computeSnapshotDelta(
      { ...facebookCumulativeTotals(reel()), denominators: undefined },
      null,
    );

    expect(() =>
      buildSnapshotDeltaRow({
        projectId: 'proj',
        videoId: 'pub',
        platform: 'instagram',
        metricDate: '2026-10-01',
        delta,
      }),
    ).toThrow(/no views/);
  });
});

describe('buildFacebookRetentionPoints', () => {
  it('writes the graph as Facebook curve points', () => {
    expect(
      buildFacebookRetentionPoints({
        projectId: 'proj',
        videoId: 'pub',
        retention: [
          { elapsedRatio: 0, watchRatio: 1 },
          { elapsedRatio: 0.5, watchRatio: 0.4 },
          { elapsedRatio: 1, watchRatio: 0.1 },
        ],
      }),
    ).toEqual([
      {
        project_id: 'proj',
        video_id: 'pub',
        platform: 'facebook',
        elapsed_ratio: 0,
        audience_watch_ratio: 1,
      },
      {
        project_id: 'proj',
        video_id: 'pub',
        platform: 'facebook',
        elapsed_ratio: 0.5,
        audience_watch_ratio: 0.4,
      },
      {
        project_id: 'proj',
        video_id: 'pub',
        platform: 'facebook',
        elapsed_ratio: 1,
        audience_watch_ratio: 0.1,
      },
    ]);
  });

  it('writes nothing when Meta sent no graph', () => {
    expect(
      buildFacebookRetentionPoints({
        projectId: 'proj',
        videoId: 'pub',
        retention: null,
      }),
    ).toEqual([]);
  });
});
