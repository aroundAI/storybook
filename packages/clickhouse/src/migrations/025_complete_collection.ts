/**
 * Everything a morning report reads, kept (FILM-1734).
 *
 * 1. `video_snapshots` takes YouTube's live counts. `videos.list
 *    part=statistics` gives lifetime views, likes, comments and — to the
 *    channel owner only — dislikes, minutes old rather than the Analytics
 *    API's 1–2 days. They are snapshots like every other platform's:
 *    - `dislikes`: YouTube only; NULL everywhere else, and wherever YouTube
 *      left `dislikeCount` out.
 *    - `likes` and `comments` become Nullable: YouTube omits `likeCount` when
 *      likes are hidden and `commentCount` when comments are off, and neither
 *      is a 0. Every other platform still writes a number, and only those
 *      rows are delta baselines (`analytics-sync-cron.ts`
 *      `fetchSnapshotBaselines`).
 *    - `source`: the API the snapshot came from (`data_api`, `graph_api`,
 *      `tiktok_api`, `x_api`). '' on a row written before this.
 *
 * 2. `profile_visits` on `video_snapshots` (lifetime) and `video_metrics`
 *    (the day's increase): Instagram's per-post `profile_visits`, FEED and
 *    STORY only. NULL where not measured. Instagram's per-post `follows`
 *    needs no column: it is `subscribers_gained`, which Instagram rows left
 *    NULL until now.
 *
 * 3. `video_traffic_sources.metric_source`: the Analytics API's traffic
 *    sources are kept beside the Reporting CSV's (`analytics_api` and
 *    `reporting_api`, `MetricSource`'s names). The two name sources in
 *    different vocabularies (`EXT_URL` against code 9, `EXTERNAL_URL`), so
 *    they can never share a key the way `video_metrics`' two YouTube writers
 *    do: a day both measured would count its views twice. So the column is
 *    in the sort key, both copies are kept, and every reader takes one copy
 *    of a (video, day) — the Reporting CSV's where it has the day, else the
 *    Analytics API's (`TRAFFIC_SOURCES_ONE_COPY` in `queries-detail.ts`).
 *    ClickHouse refuses a sort-key column with a default, so a row written
 *    before this reads '' — every one of them from the CSV. They are copied
 *    under `reporting_api` and the '' copies deleted, or a CSV restatement
 *    (now `reporting_api`, a different key) would count the day twice.
 *    Both writers name the column explicitly.
 *
 * 4. `channel_metrics_daily`: the whole channel, per day, including videos
 *    StoryBook did not publish. One row per (connection, platform, day,
 *    source), each from one API:
 *    - `analytics_api`: YouTube's channel-wide day (`ids=channel==MINE`, no
 *      video filter): views, watch time, likes, dislikes, comments, shares,
 *      subscribers gained and lost.
 *    - `data_api`: YouTube `channels.list part=statistics` that night: the
 *      channel's lifetime views, subscribers (rounded by YouTube above
 *      1,000) and public video count.
 *    - `graph_api`: Instagram's account views that day. The account's
 *      unique reach for the day is a unique count, so it goes to
 *      `channel_windows` as a 1-day window, never here, where a column
 *      could be summed across days.
 *    Every figure is Nullable: a source fills its own columns and leaves
 *    the rest NULL, never 0. `inserted_at` is DateTime64(3) for migration
 *    008's reason.
 *
 * Additive, apart from the two Nullable widenings, which hold every
 * existing value. Deploy BEFORE the app, which writes the new columns.
 *
 * Rollback: roll the app back first, then
 *   DROP TABLE IF EXISTS channel_metrics_daily;
 *   ALTER TABLE video_traffic_sources DELETE WHERE metric_source = 'analytics_api'
 *     SETTINGS mutations_sync = 2;
 *   (the sort-key column stays, holding 'reporting_api': ClickHouse cannot
 *   drop a sort-key column, and the old readers sum every row, which is the
 *   CSV's alone once the API's are deleted)
 *   ALTER TABLE video_metrics DROP COLUMN IF EXISTS profile_visits;
 *   ALTER TABLE video_snapshots DELETE WHERE platform = 'youtube'
 *     SETTINGS mutations_sync = 2;
 *   ALTER TABLE video_snapshots DROP COLUMN IF EXISTS dislikes,
 *     DROP COLUMN IF EXISTS profile_visits, DROP COLUMN IF EXISTS source;
 *   and, only once no NULL is left, MODIFY likes and comments back to UInt32.
 */
import type { ClickHouseClient } from '@clickhouse/client';

import { PLATFORM_ENUM_TYPE } from '../lib/platform-enum';
import type { ClickHouseMigration } from './migration-types';

export const STATEMENTS = [
  `ALTER TABLE video_snapshots
    ADD COLUMN IF NOT EXISTS dislikes Nullable(UInt32),
    ADD COLUMN IF NOT EXISTS profile_visits Nullable(UInt64),
    ADD COLUMN IF NOT EXISTS source LowCardinality(String) DEFAULT '',
    MODIFY COLUMN likes Nullable(UInt32),
    MODIFY COLUMN comments Nullable(UInt32)`,
  `ALTER TABLE video_metrics
    ADD COLUMN IF NOT EXISTS profile_visits Nullable(UInt64)`,
  `ALTER TABLE video_traffic_sources
    ADD COLUMN IF NOT EXISTS metric_source LowCardinality(String),
    MODIFY ORDER BY (project_id, platform, video_id, metric_date, source, metric_source)`,
  `CREATE TABLE IF NOT EXISTS channel_metrics_daily (
    connection_id UUID,
    platform ${PLATFORM_ENUM_TYPE},
    metric_date Date,
    source LowCardinality(String),
    views Nullable(UInt64),
    watch_time_seconds Nullable(UInt64),
    likes Nullable(UInt64),
    dislikes Nullable(UInt64),
    comments Nullable(UInt64),
    shares Nullable(UInt64),
    subscribers_gained Nullable(UInt64),
    subscribers_lost Nullable(UInt64),
    lifetime_views Nullable(UInt64),
    lifetime_subscribers Nullable(UInt64),
    lifetime_videos Nullable(UInt64),
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (connection_id, platform, metric_date, source)`,
];

export const DELETE_LEGACY_TRAFFIC = `ALTER TABLE video_traffic_sources
    DELETE WHERE metric_source = ''
    SETTINGS mutations_sync = 2`;

/** One month (YYYYMM) of the pre-025 traffic rows, copied under 'reporting_api'. */
export function copyLegacyTrafficMonth(month: number): string {
  if (!Number.isInteger(month) || month < 190001 || month > 299912) {
    throw new Error(`Not a YYYYMM month: ${month}`);
  }
  return `INSERT INTO video_traffic_sources
    (project_id, video_id, platform, metric_date, source, views,
     watch_time_minutes, inserted_at, metric_source)
    SELECT project_id, video_id, platform, metric_date, source, views,
      watch_time_minutes, inserted_at, 'reporting_api'
    FROM video_traffic_sources FINAL
    WHERE metric_source = '' AND toYYYYMM(metric_date) = ${month}`;
}

async function legacyTrafficMonths(
  client: ClickHouseClient,
): Promise<number[]> {
  const result = await client.query({
    query: `SELECT DISTINCT toYYYYMM(metric_date) AS month
      FROM video_traffic_sources
      WHERE metric_source = ''
      ORDER BY month`,
    format: 'JSONEachRow',
  });
  const rows = await result.json<{ month: number | string }>();
  return rows.map((row) => Number(row.month));
}

export const migration: ClickHouseMigration = {
  name: '025_complete_collection',
  async up(client) {
    const [columns, rest] = [STATEMENTS.slice(0, 3), STATEMENTS.slice(3)];

    for (const query of columns) {
      await client.command({ query });
    }

    // The rows written before this carry '' and came from the CSV. A CSV
    // restatement now writes 'reporting_api', which would sit beside the ''
    // copy on a different key and count the day twice, so the old rows are
    // copied under their real name — `inserted_at` kept, so a later write
    // still replaces them — and the '' copies deleted. Safe to re-run.
    // One insert per month: the table is partitioned by month, and an
    // insert spanning more than max_partitions_per_insert_block (100) is
    // refused; a managed server may forbid raising it (KB-201).
    for (const month of await legacyTrafficMonths(client)) {
      await client.command({ query: copyLegacyTrafficMonth(month) });
    }
    await client.command({ query: DELETE_LEGACY_TRAFFIC });

    for (const query of rest) {
      await client.command({ query });
    }
  },
};
