import { describe, expect, it } from 'vitest';

import { getClickHouseClient } from '@kit/clickhouse/server';

import { upsertVideoDims } from '../src/server/dim-sync';

/**
 * The real reconcile, against the real local stack (FILM-1710 §7).
 *
 * `dim-sync.test.ts` proves the mapping. It cannot prove that the select
 * names a column Postgres has, or that ClickHouse accepts the row — a mocked
 * client rejects nothing, and ClickHouse drops a JSON field it does not know
 * rather than refusing it, so a stale `duration_seconds` writer fails
 * silently. This runs `upsertVideoDims()` for real and reads `video_dim`
 * back.
 *
 * Off unless asked for: it needs `./scripts/local-env.sh up`, the seeded
 * "The Chronicles" fixture (`supabase/seeds/analytics-mock-data.sql`) and
 * the environment from `deployment/config/local.env`.
 *
 *   set -a; . deployment/config/local.env; set +a
 *   DIM_SYNC_LOCAL_STACK=1 pnpm --filter @kit/content-analytics test dim-sync.local-stack
 */
const FIXTURE_PROJECT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe.skipIf(!process.env.DIM_SYNC_LOCAL_STACK)(
  'upsertVideoDims against local Postgres and ClickHouse',
  () => {
    it('writes the clip’s duration beside the episode’s, and null where no platform reported one', async () => {
      const synced = await upsertVideoDims();

      expect(synced).toBeGreaterThan(0);

      // The spec's own verification query, scoped to the fixture project.
      const result = await getClickHouseClient().query({
        query: `
          SELECT platform, content_type,
                 count() AS videos,
                 round(avg(episode_duration_seconds)) AS episode,
                 round(avg(asset_duration_seconds)) AS asset,
                 countIf(asset_duration_seconds IS NULL) AS asset_unknown,
                 countIf(asset_duration_seconds = 0) AS asset_zero
          FROM video_dim FINAL
          WHERE project_id = {projectId:UUID}
          GROUP BY platform, content_type
          ORDER BY platform, content_type`,
        query_params: { projectId: FIXTURE_PROJECT },
        format: 'JSONEachRow',
      });

      const rows = await result.json<{
        platform: string;
        content_type: string;
        videos: string;
        episode: number;
        asset: number | null;
        asset_unknown: string;
        asset_zero: string;
      }>();

      // eslint-disable-next-line no-console
      console.table(rows);

      const by = new Map(rows.map((row) => [row.platform, row]));

      // TikTok Shorts: seeded at 30-59s, cut from ~1,500s episodes. Before
      // FILM-1710 the only duration on these rows was the episode's.
      const tiktok = by.get('tiktok')!;

      expect(tiktok.content_type).toBe('short');
      expect(tiktok.episode).toBeGreaterThan(1000);
      expect(tiktok.asset).toBeGreaterThanOrEqual(30);
      expect(tiktok.asset).toBeLessThan(60);
      expect(Number(tiktok.asset_unknown)).toBe(0);

      // Instagram: Meta has no duration field, so every row is unknown —
      // null, never 0 and never the episode.
      const instagram = by.get('instagram')!;

      expect(instagram.asset).toBeNull();
      expect(Number(instagram.asset_unknown)).toBe(Number(instagram.videos));

      // A YouTube full is the episode render, so the two agree.
      const youtube = by.get('youtube')!;

      expect(youtube.asset).toBe(youtube.episode);

      for (const row of rows) {
        expect(Number(row.asset_zero), `${row.platform} zero`).toBe(0);
      }
    });
  },
);
