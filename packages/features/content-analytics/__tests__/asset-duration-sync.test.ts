import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TikTokAnalyticsScopeError } from '../src/providers/tiktok';
import {
  runAssetDurationBackfillBatch,
  syncAssetDurations,
} from '../src/server/asset-duration-sync';
import type { AssetDurationCandidate } from '../src/server/asset-duration-sync';

const youtubeDurations = vi.fn();
const tiktokDurations = vi.fn();
const upsertVideoDims = vi.fn();

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../src/providers/youtube', () => ({
  createYouTubeAnalyticsProvider: () => ({
    getVideoDurations: youtubeDurations,
  }),
}));

vi.mock('../src/providers/tiktok', async (original) => ({
  ...(await original<typeof import('../src/providers/tiktok')>()),
  createTikTokAnalyticsProvider: () => ({
    getVideoDurations: tiktokDurations,
  }),
}));

vi.mock('../src/server/dim-sync', () => ({
  upsertVideoDims: (ids?: string[]) => upsertVideoDims(ids),
}));

const adminClient = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => adminClient.current,
}));

interface RecordedWrite {
  values: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
}

/**
 * Just enough PostgREST: `update` chains record their values and filters;
 * `select` chains record their filters and answer with `rows`, honouring
 * `gt('id', …)` and `range` so the cursor and the paging are real.
 */
function fakeClient(rows: AssetDurationCandidate[] = []) {
  const writes: RecordedWrite[] = [];
  const reads: Array<Array<[string, string, unknown]>> = [];

  const client = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const write: RecordedWrite = { values, filters: [] };
        const chain = {
          eq: (column: string, value: unknown) => {
            write.filters.push(['eq', column, value]);
            return chain;
          },
          is: (column: string, value: unknown) => {
            write.filters.push(['is', column, value]);
            return chain;
          },
          then: (resolve: (result: { error: null }) => void) => {
            writes.push(write);
            resolve({ error: null });
          },
        };

        return chain;
      },
      select: () => {
        const filters: Array<[string, string, unknown]> = [];
        let after: string | null = null;
        let window: [number, number] = [0, 999];

        const chain = {
          eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), chain),
          not: (c: string, _op: string, v: unknown) => (
            filters.push(['not', c, v]),
            chain
          ),
          is: (c: string, v: unknown) => (filters.push(['is', c, v]), chain),
          in: (c: string, v: unknown) => (filters.push(['in', c, v]), chain),
          gt: (c: string, v: string) => {
            filters.push(['gt', c, v]);
            after = v;
            return chain;
          },
          order: (c: string) => (filters.push(['order', c, null]), chain),
          range: (from: number, to: number) => {
            window = [from, to];
            return chain;
          },
          then: (
            resolve: (result: {
              data: AssetDurationCandidate[];
              error: null;
            }) => void,
          ) => {
            reads.push(filters);
            resolve({
              data: rows
                .filter((row) => after === null || row.id > after)
                .slice(window[0], window[1] + 1),
              error: null,
            });
          },
        };

        return chain;
      },
    }),
  };

  // The function under test takes a SupabaseClient; this is the slice of
  // one it uses.
  return {
    client: client as unknown as Parameters<typeof syncAssetDurations>[0],
    writes,
    reads,
  };
}

const validToken = async () => ({ valid: true, accessToken: 'token' });

const candidate = (
  id: string,
  platform: string,
  connection: string | null = 'conn-1',
): AssetDurationCandidate => ({
  id,
  platform,
  platform_connection_id: connection,
  platform_content_id: `content-${id}`,
});

beforeEach(() => {
  youtubeDurations.mockReset();
  tiktokDurations.mockReset();
  upsertVideoDims.mockReset();
});

describe('syncAssetDurations', () => {
  it('writes what the provider reports, and only into a null', async () => {
    const { client, writes } = fakeClient();

    youtubeDurations.mockResolvedValue(new Map([['content-p1', 45]]));

    const result = await syncAssetDurations(
      client,
      [candidate('p1', 'youtube')],
      { ensureValidToken: validToken },
    );

    expect(result).toMatchObject({ written: 1, writtenIds: ['p1'], gaps: {} });
    expect(writes).toEqual([
      {
        values: { duration_seconds: 45 },
        filters: [
          ['eq', 'id', 'p1'],
          // Fill-only: a duration already on the row is never overwritten.
          ['is', 'duration_seconds', null],
        ],
      },
    ]);
  });

  it('makes one provider call per connection, not one per publish', async () => {
    const { client } = fakeClient();

    youtubeDurations.mockResolvedValue(
      new Map([
        ['content-p1', 45],
        ['content-p2', 933],
      ]),
    );

    await syncAssetDurations(
      client,
      [candidate('p1', 'youtube'), candidate('p2', 'youtube')],
      { ensureValidToken: validToken },
    );

    expect(youtubeDurations).toHaveBeenCalledTimes(1);
    expect(youtubeDurations).toHaveBeenCalledWith(['content-p1', 'content-p2']);
  });

  it('leaves a publish the provider did not report null, and says why', async () => {
    const { client, writes } = fakeClient();

    youtubeDurations.mockResolvedValue(new Map());

    const result = await syncAssetDurations(
      client,
      [candidate('p1', 'youtube')],
      { ensureValidToken: validToken },
    );

    expect(writes).toEqual([]);
    expect(result).toMatchObject({ written: 0, gaps: { not_reported: 1 } });
  });

  it('never asks Meta: an Instagram publish is not a candidate at all', async () => {
    const { client, writes } = fakeClient();
    const ensureValidToken = vi.fn(validToken);

    const result = await syncAssetDurations(
      client,
      [candidate('ig1', 'instagram')],
      { ensureValidToken },
    );

    expect(result).toMatchObject({ candidates: 0, written: 0, gaps: {} });
    expect(ensureValidToken).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  // The TikTok leg as it stands before FILM-1711: the request is made, the
  // connection lacks `video.list`, and the rows stay `duration_unknown`.
  it('records a TikTok scope refusal as a gap and writes nothing', async () => {
    const { client, writes } = fakeClient();

    tiktokDurations.mockRejectedValue(new TikTokAnalyticsScopeError());

    const result = await syncAssetDurations(
      client,
      [candidate('t1', 'tiktok'), candidate('t2', 'tiktok')],
      { ensureValidToken: validToken },
    );

    expect(writes).toEqual([]);
    expect(result).toMatchObject({ written: 0, gaps: { scope_missing: 2 } });
  });

  it('contains a failure to its connection: the next connection is still asked', async () => {
    const { client, writes } = fakeClient();

    tiktokDurations.mockRejectedValue(new TikTokAnalyticsScopeError());
    youtubeDurations.mockResolvedValue(new Map([['content-y1', 45]]));

    const result = await syncAssetDurations(
      client,
      [candidate('t1', 'tiktok', 'conn-tt'), candidate('y1', 'youtube')],
      { ensureValidToken: validToken },
    );

    expect(writes.map((write) => write.values)).toEqual([
      { duration_seconds: 45 },
    ]);
    expect(result).toMatchObject({
      written: 1,
      writtenIds: ['y1'],
      gaps: { scope_missing: 1 },
    });
  });

  it('does not call a provider when the token cannot be validated', async () => {
    const { client } = fakeClient();

    const result = await syncAssetDurations(
      client,
      [candidate('p1', 'youtube')],
      { ensureValidToken: async () => ({ valid: false, error: 'EXPIRED' }) },
    );

    expect(youtubeDurations).not.toHaveBeenCalled();
    expect(result.gaps).toEqual({ token_invalid: 1 });
  });

  it('counts a publish with no connection rather than dropping it', async () => {
    const { client } = fakeClient();

    const result = await syncAssetDurations(
      client,
      [candidate('p1', 'youtube', null)],
      { ensureValidToken: validToken },
    );

    expect(result).toMatchObject({
      candidates: 1,
      gaps: { no_connection: 1 },
    });
  });

  it('a dry run counts candidates and touches nothing', async () => {
    const { client, writes } = fakeClient();
    const ensureValidToken = vi.fn(validToken);

    const result = await syncAssetDurations(
      client,
      [candidate('p1', 'youtube')],
      { dryRun: true, ensureValidToken },
    );

    expect(result).toMatchObject({ candidates: 1, written: 0, dryRun: true });
    expect(ensureValidToken).not.toHaveBeenCalled();
    expect(youtubeDurations).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('runAssetDurationBackfillBatch', () => {
  it('reads only published YouTube and TikTok rows still missing a duration, in id order', async () => {
    const fake = fakeClient([]);

    adminClient.current = fake.client;

    await runAssetDurationBackfillBatch({ dryRun: true });

    expect(fake.reads[0]).toEqual([
      ['eq', 'status', 'published'],
      ['not', 'platform_content_id', null],
      ['is', 'duration_seconds', null],
      ['in', 'platform', ['youtube', 'tiktok']],
      ['order', 'id', null],
    ]);
  });

  it('caps the batch and hands back a cursor, so unresolvable rows cannot starve the rest', async () => {
    const rows = ['a', 'b', 'c'].map((id) => candidate(id, 'youtube'));
    const fake = fakeClient(rows);

    adminClient.current = fake.client;

    const first = await runAssetDurationBackfillBatch({
      maxPublishes: 2,
      dryRun: true,
    });

    expect(first).toMatchObject({
      candidates: 2,
      remaining: 1,
      nextAfterId: 'b',
    });

    const second = await runAssetDurationBackfillBatch({
      maxPublishes: 2,
      afterId: 'b',
      dryRun: true,
    });

    expect(second).toMatchObject({
      candidates: 1,
      remaining: 0,
      nextAfterId: null,
    });
  });

  it('re-upserts exactly the rows it wrote into video_dim', async () => {
    const fake = fakeClient([
      candidate('a', 'youtube'),
      candidate('b', 'youtube'),
    ]);

    adminClient.current = fake.client;
    youtubeDurations.mockResolvedValue(new Map([['content-a', 45]]));

    // The real token refresher is loaded dynamically; stub it at the module.
    vi.doMock('@kit/publishing/token-refresh', () => ({
      ensureValidToken: validToken,
    }));

    const result = await runAssetDurationBackfillBatch();

    expect(result).toMatchObject({ written: 1, gaps: { not_reported: 1 } });
    expect(upsertVideoDims).toHaveBeenCalledWith(['a']);
  });
});
