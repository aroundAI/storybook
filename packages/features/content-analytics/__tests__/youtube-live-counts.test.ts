import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureYouTubeLiveCounts } from '../src/server/analytics-sync-cron';
import type { PublishForSync } from '../src/server/types';

/**
 * FILM-1734 §1a. The hourly sync asks YouTube for the live counts of the
 * run's YouTube publishes, one call per channel, and stores them as
 * `data_api` snapshots under each publish id. A channel that fails costs
 * only its own counts.
 */

const calls = vi.hoisted(() => ({
  statistics: [] as string[][],
  inserted: [] as unknown[],
  failToken: new Set<string>(),
  failCall: false,
  missing: new Set<string>(),
  removed: [] as Array<[string, string]>,
}));

vi.mock('@kit/publishing/lib/publish-removal', () => ({
  notFoundOn: (platform: string) => `not found on ${platform}`,
  recordPublishRemoved: async (
    _client: unknown,
    id: string,
    reason: string,
  ) => {
    calls.removed.push([id, reason]);
    return true;
  },
}));

vi.mock('@kit/clickhouse/server', () => ({
  formatDateStr: () => '2026-10-11',
  insertVideoSnapshots: async (rows: unknown[]) => {
    calls.inserted.push(...rows);
  },
}));
vi.mock('@kit/supabase/server-admin-client', () => ({}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock('@kit/publishing/token-refresh', () => ({
  ensureValidToken: async (connectionId: string) =>
    calls.failToken.has(connectionId)
      ? { valid: false, error: 'REFRESH_FAILED' }
      : { valid: true, accessToken: `token-${connectionId}` },
}));
vi.mock('../src/providers/youtube', () => ({
  YouTubeAnalyticsScopeError: class extends Error {},
  createYouTubeAnalyticsProvider: () => ({
    fetchVideoStatistics: async (ids: string[]) => {
      calls.statistics.push(ids);
      if (calls.failCall) throw new Error('quotaExceeded');
      return new Map(
        ids
          .filter((id) => !calls.missing.has(id))
          .map((id) => [
            id,
            { videoId: id, views: 100, likes: 5, dislikes: 1, comments: 2 },
          ]),
      );
    },
  }),
}));

const client = {
  from: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: { project_id: 'project-1' }, error: null }),
    };
    return builder;
  },
} as unknown as Parameters<typeof captureYouTubeLiveCounts>[0];

const publish = (id: string, connection: string): PublishForSync => ({
  id,
  episode_id: `episode-${id}`,
  platform: 'youtube',
  platform_connection_id: connection,
  platform_content_id: `yt-${id}`,
  published_at: '2026-10-01T00:00:00Z',
  duration_seconds: null,
  content_type: 'full',
  metadata: null,
});

beforeEach(() => {
  calls.statistics = [];
  calls.inserted = [];
  calls.failToken = new Set();
  calls.failCall = false;
  calls.missing = new Set();
  calls.removed = [];
});

describe('captureYouTubeLiveCounts', () => {
  it('asks once per channel and stores a data_api snapshot per publish', async () => {
    const written = await captureYouTubeLiveCounts(
      client,
      [publish('a', 'c1'), publish('b', 'c1'), publish('c', 'c2')],
      { name: 'test' },
    );

    expect(calls.statistics).toEqual([['yt-a', 'yt-b'], ['yt-c']]);
    expect(written).toBe(3);
    expect(calls.inserted).toEqual(
      ['a', 'b', 'c'].map((id) =>
        expect.objectContaining({
          video_id: id,
          project_id: 'project-1',
          source: 'data_api',
          dislikes: 1,
        }),
      ),
    );
  });

  it('a channel without a valid token costs only its own counts', async () => {
    calls.failToken.add('c1');

    const written = await captureYouTubeLiveCounts(
      client,
      [publish('a', 'c1'), publish('c', 'c2')],
      { name: 'test' },
    );

    expect(written).toBe(1);
    expect(calls.statistics).toEqual([['yt-c']]);
  });

  // KB-207: a video deleted on YouTube stayed 'published' for good
  it('marks a publish removed when YouTube answers without its video', async () => {
    calls.missing.add('yt-b');
    const removed = new Set<string>();

    const written = await captureYouTubeLiveCounts(
      client,
      [publish('a', 'c1'), publish('b', 'c1')],
      { name: 'test' },
      removed,
    );

    expect(calls.removed).toEqual([['b', 'not found on youtube']]);
    expect([...removed]).toEqual(['b']);
    expect(written).toBe(1);
  });

  it('marks nothing removed when the call itself fails', async () => {
    calls.failCall = true;
    const removed = new Set<string>();

    await captureYouTubeLiveCounts(
      client,
      [publish('a', 'c1')],
      { name: 'test' },
      removed,
    );

    expect(calls.removed).toEqual([]);
    expect(removed.size).toBe(0);
  });
});
