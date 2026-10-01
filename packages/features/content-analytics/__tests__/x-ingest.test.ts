import { describe, expect, it } from 'vitest';

import {
  buildSnapshotDeltaRow,
  buildXQuartilePoints,
  computeSnapshotDelta,
} from '../src/server/ingest';

/**
 * FILM-1727: what X leaves out is never turned into a zero on the way to
 * ClickHouse, and its quartiles become five points of a curve.
 */

describe('X at ingest', () => {
  it('turns the quartiles into five points, each a share of the plays that started', () => {
    expect(
      buildXQuartilePoints({
        projectId: 'p',
        videoId: 'v',
        quartiles: {
          started: 1000,
          quarter: 700,
          half: 480,
          threeQuarters: 300,
          complete: 150,
        },
      }).map((p) => [p.platform, p.elapsed_ratio, p.audience_watch_ratio]),
    ).toEqual([
      ['twitter', 0, 1],
      ['twitter', 0.25, 0.7],
      ['twitter', 0.5, 0.48],
      ['twitter', 0.75, 0.3],
      ['twitter', 1, 0.15],
    ]);
  });

  it('writes no curve when no play started, or X gave no quartiles', () => {
    const none = { projectId: 'p', videoId: 'v' };
    expect(buildXQuartilePoints({ ...none, quartiles: null })).toEqual([]);
    expect(
      buildXQuartilePoints({
        ...none,
        quartiles: {
          started: 0,
          quarter: 0,
          half: 0,
          threeQuarters: 0,
          complete: 0,
        },
      }),
    ).toEqual([]);
  });

  it('keeps X shares null through the delta and onto the row', () => {
    const delta = computeSnapshotDelta(
      {
        views: 1000,
        likes: 90,
        comments: 4,
        shares: null,
        saves: 7,
        watch_time_seconds: null,
        subscribers_gained: null,
        accounts_reached: null,
        reposts: 12,
        all_surface_views: null,
        all_surface_likes: null,
        all_surface_comments: null,
      },
      {
        snapshot_date: '2026-09-30',
        views: 800,
        likes: 60,
        comments: 3,
        shares: null,
        saves: 5,
        watch_time_seconds: null,
        subscribers_gained: null,
        accounts_reached: null,
        reposts: 10,
        all_surface_views: null,
        all_surface_likes: null,
        all_surface_comments: null,
      },
    );

    expect(delta).toMatchObject({ views: 200, shares: null, reposts: 2 });

    const row = buildSnapshotDeltaRow({
      projectId: 'p',
      videoId: 'v',
      platform: 'twitter',
      metricDate: '2026-10-01',
      delta,
    });

    expect(row).toMatchObject({
      platform: 'twitter',
      views: 200,
      likes: 30,
      comments: 1,
      shares: null,
      saves: 2,
      reposts: 2,
      watch_time_seconds: null,
      subscribers_gained: null,
      accounts_reached: null,
      metric_source: 'snapshot_delta',
    });
  });

  it('leaves TikTok and Instagram shares deltas as they were', () => {
    const delta = computeSnapshotDelta(
      {
        views: 10,
        likes: 1,
        comments: 1,
        shares: 9,
        saves: null,
        watch_time_seconds: null,
        subscribers_gained: null,
        accounts_reached: null,
        reposts: null,
        all_surface_views: null,
        all_surface_likes: null,
        all_surface_comments: null,
      },
      {
        snapshot_date: '2026-09-30',
        views: 5,
        likes: 1,
        comments: 1,
        shares: 4,
        saves: null,
        watch_time_seconds: null,
        subscribers_gained: null,
        accounts_reached: null,
        reposts: null,
        all_surface_views: null,
        all_surface_likes: null,
        all_surface_comments: null,
      },
    );

    expect(delta.shares).toBe(5);
  });
});
