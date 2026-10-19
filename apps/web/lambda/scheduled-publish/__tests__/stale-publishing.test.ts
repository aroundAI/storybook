import type { SupabaseClient } from '@supabase/supabase-js';

import { describe, expect, it } from 'vitest';

import type { Database } from '@kit/supabase/database';

import {
  STALE_PUBLISHING_ERROR,
  failStalePublishing,
} from '../stale-publishing';

/**
 * KB-206. Nine production publishes stayed 'publishing' for good when the
 * web request uploading them ended first. The scheduled job fails a row
 * still 'publishing' 30 minutes after its attempt began, and leaves one
 * still inside that window to finish.
 */

interface Row {
  id: string;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

/** An in-memory `publishes` that applies eq filters and updates */
function fakeClient(rows: Row[]) {
  return {
    from() {
      const filters: Array<[keyof Row, unknown]> = [];
      let patch: Partial<Row> | null = null;
      let window: [number, number] | null = null;

      const matching = () =>
        rows.filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        );

      const run = async () => {
        if (patch) {
          const hit = matching();
          for (const row of hit) Object.assign(row, patch);
          return { data: hit.map((row) => ({ id: row.id })), error: null };
        }

        const found = matching().map((row) => ({ ...row }));
        return {
          data: window ? found.slice(window[0], window[1] + 1) : found,
          error: null,
        };
      };

      const q = {
        select: () => q,
        update: (values: Partial<Row>) => {
          patch = values;
          return q;
        },
        eq: (column: keyof Row, value: unknown) => {
          filters.push([column, value]);
          return q;
        },
        order: () => q,
        range: (from: number, to: number) => {
          window = [from, to];
          return q;
        },
        then: (resolve: (value: unknown) => unknown) => run().then(resolve),
      };

      return q;
    },
  } as unknown as SupabaseClient<Database>;
}

const NOW = new Date('2026-10-19T12:00:00.000Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe('the stale publishing sweep (KB-206)', () => {
  it('fails a row publishing for over 30 minutes, keeping its metadata', async () => {
    const rows: Row[] = [
      {
        id: 'reel',
        status: 'publishing',
        created_at: minutesAgo(45),
        metadata: { shortsGroupId: 'g1' },
      },
    ];

    expect(await failStalePublishing(fakeClient(rows), NOW)).toBe(1);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      metadata: {
        shortsGroupId: 'g1',
        error: STALE_PUBLISHING_ERROR,
        failedAt: NOW.toISOString(),
      },
    });
    expect(STALE_PUBLISHING_ERROR).toMatch(
      /^Timed out while publishing; check the platform before retrying/,
    );
  });

  it('leaves a row inside the window, and rows in any other status', async () => {
    const rows: Row[] = [
      {
        id: 'fresh',
        status: 'publishing',
        created_at: minutesAgo(10),
        metadata: null,
      },
      {
        id: 'queued',
        status: 'queued',
        created_at: minutesAgo(600),
        metadata: null,
      },
      {
        id: 'published',
        status: 'published',
        created_at: minutesAgo(600),
        metadata: null,
      },
    ];

    expect(await failStalePublishing(fakeClient(rows), NOW)).toBe(0);
    expect(rows.map((row) => row.status)).toEqual([
      'publishing',
      'queued',
      'published',
    ]);
  });

  it("times a worker attempt from when it began, not from the row's creation", async () => {
    const rows: Row[] = [
      {
        id: 'redelivered',
        status: 'publishing',
        created_at: minutesAgo(600),
        metadata: { publishingStartedAt: minutesAgo(5) },
      },
      {
        id: 'cut-off',
        status: 'publishing',
        created_at: minutesAgo(600),
        metadata: { publishingStartedAt: minutesAgo(31) },
      },
    ];

    expect(await failStalePublishing(fakeClient(rows), NOW)).toBe(1);
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ['redelivered', 'publishing'],
      ['cut-off', 'failed'],
    ]);
  });
});
