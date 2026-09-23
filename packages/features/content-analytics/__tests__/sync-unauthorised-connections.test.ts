import { describe, expect, it, vi } from 'vitest';

import { fetchPublishesForSync } from '../src/server/analytics-sync-cron';

/**
 * FILM-1711. The sync job leaves a publish alone when its connection was never
 * granted the analytics scope, instead of calling the vendor, collecting the
 * 403 and flagging the publish. And it picks a publish back up after the
 * creator reconnects, which the `requires_reauth` flag alone never allowed.
 */

vi.mock('@kit/clickhouse/server', () => ({
  formatDateStr: () => '2026-09-22',
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

const HOUR = 3_600_000;
const publishedAt = new Date(Date.now() - 2 * HOUR).toISOString();

function publish(
  id: string,
  platform: string,
  connectionId: string,
  sync?: Record<string, unknown>,
) {
  return {
    id,
    episode_id: `episode-${id}`,
    platform,
    platform_connection_id: connectionId,
    platform_content_id: `content-${id}`,
    published_at: publishedAt,
    metadata: sync ? { sync } : null,
  };
}

function clientWith(
  publishes: ReturnType<typeof publish>[],
  connections: Array<{
    id: string;
    scopes: string[] | null;
    metadata: unknown;
    disconnected_at?: string | null;
  }>,
) {
  return {
    from: (table: string) => {
      const rows = table === 'publishes' ? publishes : connections;
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        range: async (from: number, to: number) => ({
          data: rows.slice(from, to + 1),
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows, error: null }),
      };

      return builder;
    },
  } as unknown as Parameters<typeof fetchPublishesForSync>[0];
}

const YT_ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';

describe('fetchPublishesForSync', () => {
  it('leaves unauthorised connections alone and counts them', async () => {
    const result = await fetchPublishesForSync(
      clientWith(
        [
          publish('yt', 'youtube', 'c-yt'),
          publish('tt', 'tiktok', 'c-tt'),
          publish('ig', 'instagram', 'c-ig'),
        ],
        [
          { id: 'c-yt', scopes: [YT_ANALYTICS], metadata: {} },
          {
            id: 'c-tt',
            scopes: ['user.info.basic', 'video.upload'],
            metadata: {},
          },
          {
            id: 'c-ig',
            scopes: ['instagram_basic', 'instagram_content_publish'],
            metadata: {},
          },
        ],
      ),
      50,
    );

    expect(result.publishes.map(({ id }) => id)).toEqual(['yt']);
    expect(result.notAuthorised).toBe(2);
  });

  it('hands the sync the grant it decided on', async () => {
    const result = await fetchPublishesForSync(
      clientWith(
        [publish('yt', 'youtube', 'c-yt')],
        [
          {
            id: 'c-yt',
            scopes: [YT_ANALYTICS],
            metadata: { scopes_granted_at: '2026-09-22T00:00:00.000Z' },
          },
        ],
      ),
      50,
    );

    expect(result.publishes[0]?.connection).toEqual({
      scopes: [YT_ANALYTICS],
      grantedAt: '2026-09-22T00:00:00.000Z',
      accountGated: [],
      disconnectedAt: null,
    });
  });

  it('skips a channel the creator disconnected, without counting it as unauthorised (KB-22)', async () => {
    const result = await fetchPublishesForSync(
      clientWith(
        [publish('kept', 'youtube', 'c-live'), publish('gone', 'youtube', 'c-gone')],
        [
          { id: 'c-live', scopes: [YT_ANALYTICS], metadata: {} },
          {
            id: 'c-gone',
            scopes: [YT_ANALYTICS],
            metadata: {},
            disconnected_at: '2026-09-23T00:00:00.000Z',
          },
        ],
      ),
      50,
    );

    expect(result.publishes.map(({ id }) => id)).toEqual(['kept']);
    expect(result.notAuthorised).toBe(0);
  });

  it('picks a flagged publish back up once its connection is re-authorised', async () => {
    const flagged = {
      requires_reauth: true,
      consecutive_failures: 7,
      last_failed_at: '2026-09-01T00:00:00.000Z',
    };
    const scopes = ['user.info.basic', 'video.upload', 'video.list'];

    const before = await fetchPublishesForSync(
      clientWith(
        [publish('tt', 'tiktok', 'c-tt', flagged)],
        [{ id: 'c-tt', scopes, metadata: {} }],
      ),
      50,
    );

    const after = await fetchPublishesForSync(
      clientWith(
        [publish('tt', 'tiktok', 'c-tt', flagged)],
        [
          {
            id: 'c-tt',
            scopes,
            metadata: { scopes_granted_at: '2026-09-22T00:00:00.000Z' },
          },
        ],
      ),
      50,
    );

    expect(before.publishes).toEqual([]);
    expect(before.notAuthorised).toBe(0);
    expect(after.publishes.map(({ id }) => id)).toEqual(['tt']);
  });
});
