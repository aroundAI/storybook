import { afterEach, describe, expect, it, vi } from 'vitest';

import { X_MAX_POST_READS_PER_UTC_DAY } from '../src/lib/x-read-budget';
import { fetchPublishesForSync } from '../src/server/analytics-sync-cron';

/**
 * FILM-1727. The sync is where X's spend is decided: no X publish is even
 * selected while X is switched off, and once on, the daily ceiling and the
 * 30-day wall hold across the whole run.
 */

vi.mock('@kit/clickhouse/server', () => ({
  formatDateStr: () => '2026-10-01',
}));
vi.mock('@kit/supabase/server-admin-client', () => ({}));
vi.mock('@kit/shared/logger', () => ({ getLogger: async () => ({}) }));
vi.mock('../src/providers/instagram', () => ({
  InstagramInsightsScopeError: class extends Error {},
}));
vi.mock('../src/providers/tiktok', () => ({
  TikTokAnalyticsScopeError: class extends Error {},
  TikTokRateLimitError: class extends Error {},
}));
vi.mock('../src/providers/youtube', () => ({
  YouTubeAnalyticsScopeError: class extends Error {},
}));
vi.mock('../src/providers/twitter', () => ({
  XAnalyticsScopeError: class extends Error {},
  XRateLimitError: class extends Error {},
}));

const DAY = 86_400_000;
const X_SCOPES = ['tweet.read', 'users.read', 'tweet.write', 'offline.access'];

function xPublish(id: string, ageDays: number, sync?: Record<string, unknown>) {
  return {
    id,
    episode_id: `episode-${id}`,
    platform: 'twitter',
    platform_connection_id: 'c-x',
    platform_content_id: `1${id.length}${id.charCodeAt(0)}`,
    published_at: new Date(
      Date.now() - ageDays * DAY - 3_600_000,
    ).toISOString(),
    metadata: sync ? { sync } : null,
  };
}

function clientWith(
  publishes: ReturnType<typeof xPublish>[],
  readsToday: number,
) {
  const asked: { platforms?: string[] } = {};

  const client = {
    from: (table: string) => {
      const rows =
        table === 'publishes'
          ? publishes
          : [{ id: 'c-x', scopes: X_SCOPES, metadata: {} }];
      let head = false;
      const builder = {
        select: (_: string, options?: { head?: boolean }) => {
          head = options?.head === true;
          return builder;
        },
        eq: () => builder,
        gte: () => builder,
        not: () => builder,
        in: (column: string, values: string[]) => {
          if (column === 'platform') asked.platforms = values;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        range: async (from: number, to: number) => ({
          data: rows.slice(from, to + 1),
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            head
              ? { count: readsToday, error: null }
              : { data: rows, error: null },
          ),
      };

      return builder;
    },
  } as unknown as Parameters<typeof fetchPublishesForSync>[0];

  return { client, asked };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('X is dark until switched on', () => {
  it('does not even ask for X publishes while X_ANALYTICS_ENABLED is unset', async () => {
    vi.stubEnv('X_ANALYTICS_ENABLED', '');
    const { client, asked } = clientWith([xPublish('a', 1)], 0);

    await fetchPublishesForSync(client, 50);

    expect(asked.platforms).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'facebook',
    ]);
  });

  it('asks for them once it is "true"', async () => {
    vi.stubEnv('X_ANALYTICS_ENABLED', 'true');
    const { client, asked } = clientWith([xPublish('a', 1)], 0);

    const result = await fetchPublishesForSync(client, 50);

    expect(asked.platforms).toContain('twitter');
    expect(result.publishes.map(({ id }) => id)).toEqual(['a']);
  });
});

describe('the budget holds across the run', () => {
  it('never selects a post past day 28 of the 30-day wall', async () => {
    vi.stubEnv('X_ANALYTICS_ENABLED', 'true');
    const { client } = clientWith(
      [xPublish('fresh', 3), xPublish('edge', 28), xPublish('old', 29)],
      0,
    );

    const result = await fetchPublishesForSync(client, 50);

    expect(result.publishes.map(({ id }) => id).sort()).toEqual([
      'edge',
      'fresh',
    ]);
  });

  it('stops at the daily ceiling, counting the reads earlier runs made', async () => {
    vi.stubEnv('X_ANALYTICS_ENABLED', 'true');
    const { client } = clientWith(
      [xPublish('a', 1), xPublish('b', 2), xPublish('c', 3)],
      X_MAX_POST_READS_PER_UTC_DAY - 2,
    );

    const result = await fetchPublishesForSync(client, 50);

    expect(result.publishes).toHaveLength(2);
  });

  it('does not read a post twice in one UTC day', async () => {
    vi.stubEnv('X_ANALYTICS_ENABLED', 'true');
    const { client } = clientWith(
      [
        // Due by the schedule (synced over a day ago), already read today.
        xPublish('read', 3, {
          x_read_at: new Date().toISOString(),
          last_synced_at: new Date(Date.now() - 30 * 3_600_000).toISOString(),
        }),
        xPublish('unread', 1),
      ],
      1,
    );

    const result = await fetchPublishesForSync(client, 50);

    expect(result.publishes.map(({ id }) => id)).toEqual(['unread']);
  });
});
