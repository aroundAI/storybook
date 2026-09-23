/**
 * KB-22 part B: the purge against a real ClickHouse, two connections side by
 * side.
 *
 * Seeds rows for connection A and connection B in every table the purge
 * knows about, purges A the way the job does (its Postgres publish ids plus
 * whatever `video_dim` attributes to it), then counts: A must have nothing
 * left in any table or in the `video_daily_stats` view, and B must have
 * exactly what it had. A mocked client cannot say either — it accepts SQL
 * the server rejects, and cannot tell a delete that matched nothing from one
 * that worked.
 *
 * Usage (a local server, as for `verify`):
 *   set -a; . deployment/config/local.env; set +a
 *   pnpm --filter @kit/clickhouse verify:purge
 */
import { randomUUID } from 'node:crypto';

import { getClickHouseClient, isClickHouseEnabled } from '../src/client';
import {
  PURGE_CHANNEL_TABLES,
  PURGE_INDEX_TABLE,
  PURGE_VIDEO_TABLES,
  purgeConnectionFromClickHouse,
  queryConnectionVideoIds,
} from '../src/purge';

type Fixture = {
  connectionId: string;
  projectId: string;
  accountId: string;
  /** Publish ids Postgres knows, and one only video_dim knows. */
  postgresVideoIds: string[];
  dimOnlyVideoId: string;
};

function fixture(): Fixture {
  return {
    connectionId: randomUUID(),
    projectId: randomUUID(),
    accountId: randomUUID(),
    postgresVideoIds: [randomUUID(), randomUUID()],
    dimOnlyVideoId: randomUUID(),
  };
}

const today = new Date().toISOString().slice(0, 10);

async function seed(f: Fixture) {
  const client = getClickHouseClient();
  const videos = [...f.postgresVideoIds, f.dimOnlyVideoId];
  const perVideo = (extra: Record<string, unknown>) =>
    videos.map((video_id) => ({
      project_id: f.projectId,
      video_id,
      platform: 'youtube',
      ...extra,
    }));

  const rows: Record<string, Record<string, unknown>[]> = {
    video_metrics: perVideo({ metric_date: today, views: 100 }),
    video_snapshots: perVideo({ snapshot_date: today, views: 100 }),
    video_reach_daily: perVideo({ metric_date: today, impressions: 1000 }),
    video_traffic_sources: perVideo({
      metric_date: today,
      source: 'SEARCH',
      views: 40,
    }),
    video_audience: perVideo({
      dimension: 'country',
      key: 'GB',
      views: 50,
      percentage: 50,
    }),
    video_retention_curves: perVideo({
      elapsed_ratio: 0.5,
      audience_watch_ratio: 0.4,
    }),
    channel_daily: [
      { connection_id: f.connectionId, metric_date: today, views: 300 },
    ],
    channel_subscribers: [
      {
        connection_id: f.connectionId,
        snapshot_date: today,
        subscriber_count: 1234,
      },
    ],
    channel_reach_daily: [
      { connection_id: f.connectionId, metric_date: today, impressions: 900 },
    ],
    video_dim: videos.map((video_id) => ({
      video_id,
      project_id: f.projectId,
      account_id: f.accountId,
      episode_id: randomUUID(),
      platform: 'youtube',
      content_type: 'full',
      language: 'en',
      title: 'KB-22 purge probe',
      published_at: `${today} 00:00:00`,
      episode_duration_seconds: 60,
      tags: [],
      connection_id: f.connectionId,
    })),
  };

  for (const [table, values] of Object.entries(rows)) {
    if (!present.has(table)) continue;
    await client.insert({ table, values, format: 'JSONEachRow' });
  }
}

/** Tables this server has; channel_reach_daily only after FILM-1504's 011. */
let present = new Set<string>();

const TABLES = [
  ...PURGE_VIDEO_TABLES,
  ...PURGE_CHANNEL_TABLES,
  PURGE_INDEX_TABLE,
] as const;

async function counts(f: Fixture): Promise<Record<string, number>> {
  const client = getClickHouseClient();
  const videos = [...f.postgresVideoIds, f.dimOnlyVideoId];
  const result: Record<string, number> = {};

  for (const table of [...TABLES, 'video_daily_stats'].filter((t) =>
    present.has(t),
  )) {
    const byChannel = (PURGE_CHANNEL_TABLES as readonly string[]).includes(
      table,
    );
    const where = byChannel
      ? 'connection_id = {connectionId: UUID}'
      : 'video_id IN {videos: Array(String)}';

    const response = await client.query({
      query: `SELECT count() AS rows FROM ${table} WHERE ${where}`,
      query_params: { connectionId: f.connectionId, videos },
      format: 'JSONEachRow',
    });
    const [row] = await response.json<{ rows: string }>();

    result[table] = Number(row?.rows ?? 0);
  }

  return result;
}

async function main() {
  if (!isClickHouseEnabled()) {
    throw new Error(
      'CLICKHOUSE_ENABLED is not true — load deployment/config/local.env first',
    );
  }

  // The lists above are what the purge deletes from; the server says what
  // exists. A table in the pipeline and not in the lists would keep its rows
  // for ever, and counting only the listed tables could never notice.
  const tables = await getClickHouseClient().query({
    query: `
      SELECT name FROM system.tables
      WHERE database = currentDatabase()
        AND engine NOT IN ('View', 'MaterializedView')
        AND name != '_migrations'
    `,
    format: 'JSONEachRow',
  });
  const onServer = (await tables.json<{ name: string }>()).map((t) => t.name);

  present = new Set([...onServer, 'video_daily_stats']);
  const unpurged = onServer.filter(
    (name) => !(TABLES as readonly string[]).includes(name),
  );

  if (unpurged.length > 0) {
    throw new Error(
      `tables on the server that no purge deletes from: ${unpurged.join(', ')} — add them to src/purge.ts`,
    );
  }

  const a = fixture();
  const b = fixture();

  await seed(a);
  await seed(b);

  const aBefore = await counts(a);
  const bBefore = await counts(b);

  // What the job does: Postgres's publish ids for the connection, plus every
  // video video_dim attributes to it. Only one of A's Postgres ids is passed,
  // so the other two can only be reached through video_dim.
  const fromDim = await queryConnectionVideoIds(a.connectionId);
  const deleted = await purgeConnectionFromClickHouse({
    connectionId: a.connectionId,
    videoIds: [a.postgresVideoIds[0]!, ...fromDim],
  });

  const aAfter = await counts(a);
  const bAfter = await counts(b);

  const rows = [...TABLES, 'video_daily_stats']
    .filter((table) => present.has(table))
    .map((table) => ({
      table,
      'A before': aBefore[table],
      'A after': aAfter[table],
      'B before': bBefore[table],
      'B after': bAfter[table],
      deleted: (deleted.deleted as Record<string, number>)[table] ?? '(view)',
    }));

  if (deleted.absent.length > 0) {
    console.log(`Listed but not on this server: ${deleted.absent.join(', ')}`);
  }

  console.table(rows);

  const failures = rows.filter(
    (row) =>
      row['A after'] !== 0 ||
      row['B after'] !== row['B before'] ||
      (row['A before'] ?? 0) === 0 ||
      (row['B before'] ?? 0) === 0,
  );

  // B's rows were only ever test data: remove them too.
  await purgeConnectionFromClickHouse({
    connectionId: b.connectionId,
    videoIds: [...b.postgresVideoIds, b.dimOnlyVideoId],
  });

  if (fromDim.length !== 3) {
    throw new Error(
      `video_dim attributed ${fromDim.length} videos to A, expected 3`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `purge left A's rows or touched B's: ${failures.map((f) => f.table).join(', ')}`,
    );
  }

  console.log(
    `OK: A's rows gone from all ${rows.length - 1} tables on this server and the view; B untouched`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getClickHouseClient().close();
  });
