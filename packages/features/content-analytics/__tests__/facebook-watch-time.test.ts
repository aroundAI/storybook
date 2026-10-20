import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FacebookInsightsResult } from '../src/providers/facebook/types';

/**
 * KB-212. A Facebook video's watch time was `post_video_view_time` when the
 * optional Reels read came back and `total_video_view_total_time` when it
 * did not, so one day's delta could subtract one metric from the other.
 * Each publish now reads one metric, chosen by what it is, and a missing
 * metric is not measured. Meta's own average, never requested before, is
 * read the same way and stored on the snapshot.
 */
const metaFetch = vi.fn();

vi.mock('@kit/shared/vendors', () => ({
  metaFetch: (...args: unknown[]) => metaFetch(...args),
}));

const { FacebookInsightsProvider } = await import(
  '../src/providers/facebook/facebook-insights'
);
const { buildSnapshotRow, facebookCumulativeTotals } = await import(
  '../src/server/ingest'
);

const REELS = /blue_reels_play_count/;
const VIDEO = /total_video_views,/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function insights(values: Record<string, number>) {
  return json({
    data: Object.entries(values).map(([name, value]) => ({
      name,
      values: [{ value }],
    })),
  });
}

/** Meta's answers: the video read always, the Reels read when it is not refused. */
function answer(reels: () => Response) {
  metaFetch.mockImplementation(async (path: string) => {
    const decoded = decodeURIComponent(path);
    if (REELS.test(decoded)) return reels();
    if (VIDEO.test(decoded)) {
      return insights({
        total_video_views: 800,
        total_video_view_total_time: 4_000_000,
        total_video_avg_time_watched: 5_000,
      });
    }
    if (path.includes('?fields=post_id')) {
      return json({
        post_id: 'post-1',
        comments: { summary: { total_count: 3 } },
      });
    }
    return json({ data: [] });
  });
}

const reelsAnswer = () =>
  insights({
    blue_reels_play_count: 900,
    post_video_view_time: 7_000_000,
    post_video_avg_time_watched: 7_780,
  });

const refused = () =>
  json({ error: { code: 100, message: 'Unsupported for this video' } }, 400);

async function read(reel: boolean) {
  return new FacebookInsightsProvider('token').getVideoInsights({
    videoId: 'v1',
    reel,
  });
}

describe('Facebook watch time, one metric per publish (KB-212)', () => {
  beforeEach(() => {
    metaFetch.mockReset();
  });

  it('a Reel reads post_video_view_time and its average', async () => {
    answer(reelsAnswer);

    const { totals } = await read(true);

    expect(totals.viewTimeMs).toBe(7_000_000);
    expect(totals.avgWatchTimeMs).toBe(7_780);
  });

  it('a Reel whose Reels read was refused has no watch time, not the video metric', async () => {
    answer(refused);

    const { totals } = await read(true);

    expect(totals.viewTimeMs).toBeNull();
    expect(totals.avgWatchTimeMs).toBeNull();
    // What the video read measured still counts.
    expect(totals.threeSecondViews).toBe(800);
  });

  it('a long video reads total_video_view_total_time even when the Reels read answers', async () => {
    answer(reelsAnswer);

    const { totals } = await read(false);

    expect(totals.viewTimeMs).toBe(4_000_000);
    expect(totals.avgWatchTimeMs).toBe(5_000);
  });

  it('asks for Meta’s averages in the reads they belong to', async () => {
    answer(reelsAnswer);

    await read(true);

    const asked = metaFetch.mock.calls.map(([path]) =>
      decodeURIComponent(path as string),
    );
    expect(asked.find((path) => VIDEO.test(path))).toContain(
      'total_video_avg_time_watched',
    );
    expect(asked.find((path) => REELS.test(path))).toContain(
      'post_video_avg_time_watched',
    );
  });

  it('stores Meta’s average on the snapshot, as reported, and never in a delta', async () => {
    answer(reelsAnswer);

    const analytics: FacebookInsightsResult = await read(true);
    const totals = facebookCumulativeTotals(analytics);
    const row = buildSnapshotRow({
      projectId: 'p1',
      videoId: 'publish-1',
      platform: 'facebook',
      snapshotDate: '2026-10-20',
      totals,
      analytics,
    });

    expect(row.fb_avg_watch_time_ms).toBe(7_780);
    expect(row.watch_time_seconds).toBe(7_000);
    expect(totals).not.toHaveProperty('fb_avg_watch_time_ms');
  });
});
