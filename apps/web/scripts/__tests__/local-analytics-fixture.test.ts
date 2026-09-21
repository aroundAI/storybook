import { describe, expect, it } from 'vitest';

import type { VideoDim } from '@kit/clickhouse/server';

import { buildLocalAnalyticsFixture } from '../local-analytics-fixture';

/**
 * FILM-1701 §6. The local fixture stamped `platform: 'youtube'` on every row
 * while cycling through every publish, so TikTok and Instagram videos
 * carried YouTube traffic sources. Phase 17's pages are about which platform
 * a number came from; a fixture that cannot show one verifies nothing.
 */
const PROJECT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function dim(videoId: string, platform: string): VideoDim {
  return {
    video_id: videoId,
    project_id: PROJECT,
    account_id: '00000000-0000-0000-0000-0000000000aa',
    episode_id: '00000000-0000-0000-0000-0000000000ee',
    connection_id: '00000000-0000-0000-0000-000000000000',
    platform,
    content_type: 'full',
    language: 'en',
    title: videoId,
    published_at: '2026-01-01 00:00:00',
    duration_seconds: 60,
    tags: [],
  };
}

// The seeded project's real mix: 16 YouTube, 16 TikTok, 9 Instagram.
const dims = [
  ...Array.from({ length: 16 }, (_, i) => dim(`yt-${i}`, 'youtube')),
  ...Array.from({ length: 16 }, (_, i) => dim(`tt-${i}`, 'tiktok')),
  ...Array.from({ length: 9 }, (_, i) => dim(`ig-${i}`, 'instagram')),
];

const platformOf = new Map(dims.map((d) => [d.video_id, d.platform]));

const build = () =>
  buildLocalAnalyticsFixture({
    dims,
    from: new Date('2025-09-21T00:00:00.000Z'),
    weeks: 52,
  });

describe('the local analytics fixture', () => {
  it('writes every row under the platform of the publish it belongs to', () => {
    const { traffic, metrics } = build();

    expect(traffic.length).toBeGreaterThan(0);
    expect(metrics.length).toBeGreaterThan(0);

    for (const row of [...traffic, ...metrics]) {
      expect(row.platform, row.video_id).toBe(platformOf.get(row.video_id));
    }
  });

  it('gives traffic sources to YouTube and to nothing else', () => {
    // Absence has to be representable: TikTok's are not ingested and
    // Instagram has no such concept.
    const platforms = new Set(build().traffic.map((row) => row.platform));

    expect([...platforms]).toEqual(['youtube']);
  });

  it('gives all three platforms metrics, each by the route its sync uses', () => {
    const sources = new Map<string, Set<string | undefined>>();

    for (const row of build().metrics) {
      const seen = sources.get(row.platform) ?? new Set();

      sources.set(row.platform, seen.add(row.metric_source));
    }

    expect(Object.fromEntries(sources)).toEqual({
      youtube: new Set(['backfill']),
      tiktok: new Set(['snapshot_delta']),
      instagram: new Set(['snapshot_delta']),
    });
  });

  it('leaves weeks 9-12 empty and week 20 at zero views, on every platform', () => {
    const { metrics } = build();
    const date = (week: number) =>
      new Date(Date.UTC(2025, 8, 21) + week * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);

    for (const week of [9, 10, 11, 12]) {
      expect(metrics.filter((row) => row.metric_date === date(week))).toEqual(
        [],
      );
    }

    const zeroWeek = metrics.filter((row) => row.metric_date === date(20));

    expect(zeroWeek.length).toBeGreaterThan(0);
    expect(zeroWeek.reduce((sum, row) => sum + row.views, 0)).toBe(0);
  });

  it('is deterministic, so a reviewed screenshot does not move on re-seed', () => {
    expect(build()).toEqual(build());
  });

  it('refuses a project with no YouTube publish rather than indexing NaN', () => {
    expect(() =>
      buildLocalAnalyticsFixture({
        dims: dims.filter((d) => d.platform !== 'youtube'),
        from: new Date('2025-09-21T00:00:00.000Z'),
        weeks: 52,
      }),
    ).toThrow(/no YouTube publish/);
  });
});
