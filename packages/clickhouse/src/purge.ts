/**
 * Deleting one connection's vendor statistics (KB-20 item 3 / KB-22 part B).
 *
 * Every per-video table is keyed by `video_id`, which is the Postgres
 * publish id (`dim-sync.ts`, `analytics-sync-cron.ts`) — a UUID, so a set of
 * them names exactly one connection's videos and no one else's. The two
 * per-channel tables are keyed by `connection_id`. `video_dim` is the index
 * from a connection to its videos, so it goes last: a purge interrupted
 * before it can still find what is left.
 *
 * A table added to the pipeline must be added here, or its rows outlive the
 * purge; `verify-purge.ts` fails when the server holds a table these lists
 * do not name. A listed table the server does not have yet is skipped and
 * reported as absent — `channel_reach_daily` arrives with FILM-1504's
 * migration 011, and the purge must work on either side of it.
 */
import { getClickHouseClient } from './client';

export const PURGE_VIDEO_TABLES = [
  'video_metrics',
  'video_snapshots',
  'video_reach_daily',
  'video_traffic_sources',
  'video_audience',
  'video_retention_curves',
] as const;

export const PURGE_CHANNEL_TABLES = [
  'channel_daily',
  'channel_subscribers',
  'channel_reach_daily',
  'channel_windows',
] as const;

export const PURGE_INDEX_TABLE = 'video_dim';

export type PurgeTable =
  | (typeof PURGE_VIDEO_TABLES)[number]
  | (typeof PURGE_CHANNEL_TABLES)[number]
  | typeof PURGE_INDEX_TABLE;

/** Ids per statement: keeps each query a bounded size. */
const VIDEO_ID_CHUNK = 1_000;

export interface PurgeTarget {
  connectionId: string;
  /** The connection's publish ids — every `video_id` it could have written. */
  videoIds: string[];
}

export interface PurgeStatement {
  table: PurgeTable;
  /** A `WHERE` clause; used both to count the rows and to delete them. */
  where: string;
  params: Record<string, unknown>;
}

/**
 * What a purge deletes, table by table, in order. Pure, so "this connection
 * and nothing else" is a property of one function: every predicate is on
 * this connection's id or its own video ids.
 */
export function purgeStatements(target: PurgeTarget): PurgeStatement[] {
  const videoIds = [...new Set(target.videoIds)].sort();
  const chunks: string[][] = [];

  for (let index = 0; index < videoIds.length; index += VIDEO_ID_CHUNK) {
    chunks.push(videoIds.slice(index, index + VIDEO_ID_CHUNK));
  }

  const connection = { connectionId: target.connectionId };

  return [
    ...PURGE_VIDEO_TABLES.flatMap((table) =>
      chunks.map((chunk) => ({
        table,
        where: 'video_id IN {videoIds: Array(String)}',
        params: { videoIds: chunk },
      })),
    ),
    ...PURGE_CHANNEL_TABLES.map((table) => ({
      table,
      where: 'connection_id = {connectionId: UUID}',
      params: connection,
    })),
    {
      table: PURGE_INDEX_TABLE,
      where: 'connection_id = {connectionId: UUID}',
      params: connection,
    },
    ...chunks.map(
      (chunk): PurgeStatement => ({
        table: PURGE_INDEX_TABLE,
        where: 'video_id IN {videoIds: Array(String)}',
        params: { videoIds: chunk },
      }),
    ),
  ];
}

/** The videos `video_dim` attributes to a connection. */
export async function queryConnectionVideoIds(
  connectionId: string,
): Promise<string[]> {
  const result = await getClickHouseClient().query({
    query: `
      SELECT DISTINCT video_id
      FROM video_dim
      WHERE connection_id = {connectionId: UUID}
    `,
    query_params: { connectionId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ video_id: string }>();

  return rows.map((row) => row.video_id);
}

async function countRows(statement: PurgeStatement): Promise<number> {
  const result = await getClickHouseClient().query({
    query: `SELECT count() AS rows FROM ${statement.table} WHERE ${statement.where}`,
    query_params: statement.params,
    format: 'JSONEachRow',
  });

  const [row] = await result.json<{ rows: string | number }>();

  return Number(row?.rows ?? 0);
}

async function existingTables(): Promise<Set<string>> {
  const result = await getClickHouseClient().query({
    query: `SELECT name FROM system.tables WHERE database = currentDatabase()`,
    format: 'JSONEachRow',
  });

  return new Set((await result.json<{ name: string }>()).map((t) => t.name));
}

export interface PurgeOutcome {
  /** Rows deleted, per table. */
  deleted: Partial<Record<PurgeTable, number>>;
  /** Listed tables this server does not have (nothing there to delete). */
  absent: PurgeTable[];
}

/**
 * Deletes the target's rows from every table and proves they are gone.
 *
 * `ALTER TABLE … DELETE` with `mutations_sync = 2` rewrites the parts and
 * waits for every replica, so the rows are physically removed before this
 * returns (owner decision D9). Each statement is re-counted afterwards; a
 * non-zero count throws, so the purge is recorded as failed and retried
 * rather than as done.
 */
export async function purgeConnectionFromClickHouse(
  target: PurgeTarget,
): Promise<PurgeOutcome> {
  const client = getClickHouseClient();
  const present = await existingTables();
  const deleted: Partial<Record<PurgeTable, number>> = {};
  const absent = new Set<PurgeTable>();

  for (const statement of purgeStatements(target)) {
    if (!present.has(statement.table)) {
      absent.add(statement.table);
      continue;
    }

    deleted[statement.table] ??= 0;

    const before = await countRows(statement);

    if (before === 0) continue;

    await client.command({
      query: `ALTER TABLE ${statement.table} DELETE WHERE ${statement.where}`,
      query_params: statement.params,
      clickhouse_settings: { mutations_sync: '2' },
    });

    const after = await countRows(statement);

    if (after !== 0) {
      throw new Error(
        `${statement.table}: ${after} of ${before} rows remain after the delete`,
      );
    }

    deleted[statement.table] = (deleted[statement.table] ?? 0) + before;
  }

  return { deleted, absent: [...absent] };
}
