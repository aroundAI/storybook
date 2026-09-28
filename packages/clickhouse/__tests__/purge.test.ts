import { describe, expect, it } from 'vitest';

import {
  PURGE_CHANNEL_TABLES,
  PURGE_INDEX_TABLE,
  PURGE_VIDEO_TABLES,
  purgeStatements,
} from '../src/purge';

/**
 * KB-22 part B. What a purge deletes is decided by one pure function, so
 * "this connection's rows and nothing else" can be read off its output: every
 * predicate names the connection's id or one of its own video ids. The real
 * server is exercised by `pnpm --filter @kit/clickhouse verify:purge`.
 */

const CONNECTION = '11111111-1111-4111-8111-111111111111';

describe('purgeStatements', () => {
  it('covers every table — eleven, with channel_windows (migration 016) — video_dim last', () => {
    const statements = purgeStatements({
      connectionId: CONNECTION,
      videoIds: ['p1', 'p2'],
    });

    // Written out, not derived from the module's own lists: a table dropped
    // from a list must fail here, not agree with itself.
    expect([...new Set(statements.map((s) => s.table))].sort()).toEqual(
      [
        'channel_daily',
        'channel_reach_daily',
        'channel_subscribers',
        'channel_windows',
        'video_audience',
        'video_dim',
        'video_metrics',
        'video_reach_daily',
        'video_retention_curves',
        'video_snapshots',
        'video_traffic_sources',
      ].sort(),
    );
    expect(statements.at(-1)?.table).toBe(PURGE_INDEX_TABLE);
    expect(PURGE_VIDEO_TABLES.length + PURGE_CHANNEL_TABLES.length + 1).toBe(
      11,
    );
  });

  it('keys every statement on the connection or its own videos only', () => {
    for (const statement of purgeStatements({
      connectionId: CONNECTION,
      videoIds: ['p1', 'p2'],
    })) {
      if (statement.where === 'connection_id = {connectionId: UUID}') {
        expect(statement.params).toEqual({ connectionId: CONNECTION });
      } else {
        expect(statement.where).toBe('video_id IN {videoIds: Array(String)}');
        expect(statement.params).toEqual({ videoIds: ['p1', 'p2'] });
      }
    }
  });

  it('skips the per-video tables when the connection has no videos', () => {
    const statements = purgeStatements({
      connectionId: CONNECTION,
      videoIds: [],
    });

    expect(statements.map((s) => s.table)).toEqual([
      ...PURGE_CHANNEL_TABLES,
      PURGE_INDEX_TABLE,
    ]);
  });

  it('chunks a long id list rather than sending one enormous query', () => {
    const videoIds = Array.from({ length: 2_500 }, (_, i) => `p${i}`);
    const perTable = purgeStatements({ connectionId: CONNECTION, videoIds })
      .filter((s) => s.table === 'video_metrics')
      .map((s) => (s.params.videoIds as string[]).length);

    expect(perTable).toEqual([1_000, 1_000, 500]);
  });

  it('never sends an empty id list, which would read as "no filter" to a careless edit', () => {
    for (const statement of purgeStatements({
      connectionId: CONNECTION,
      videoIds: [],
    })) {
      expect(statement.params).not.toHaveProperty('videoIds');
    }
  });
});
