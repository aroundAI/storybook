import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_CONSECUTIVE_FAILURES,
  type SyncStatusResponse,
  describeSyncStatus,
} from '../src/lib/sync-status';
import { FacebookInsightsScopeError } from '../src/providers/facebook';
import {
  TikTokAnalyticsProvider,
  TikTokAnalyticsScopeError,
  TikTokRateLimitError,
} from '../src/providers/tiktok/tiktok-analytics';
import {
  XAnalyticsScopeError,
  XRateLimitError,
} from '../src/providers/twitter';
import { getSyncStatusAction } from '../src/server/sync-actions';
import {
  type SyncStatusRow,
  classifySyncFailure,
  toSyncStatus,
} from '../src/server/sync-status';

/**
 * KB-150. A failed analytics sync was recorded on the publish and read by
 * nothing: `getSyncStatusAction` had no caller, so a rate limit, a refused
 * token or a 5xx left the creator's figures frozen with no word of why.
 *
 * These pin the reading the episode analytics page and the Video Log now
 * share: the failure is said in the product's words with the platform's own
 * reason beside it, the last good refresh stays a real time (or null, never
 * a made-up one), and the next successful sync clears it.
 */

const PUBLISH = '0b6f5a4e-3c1d-4e2f-9a8b-7c6d5e4f3a2b';
const EPISODE = '550e8400-e29b-41d4-a716-446655440000';
const SYNCED_AT = '2026-10-01T08:00:00.000Z';
const FAILED_AT = '2026-10-01T09:00:00.000Z';
const GRANTED_BEFORE = '2026-09-30T08:00:00.000Z';
const GRANTED_AFTER = '2026-10-01T10:00:00.000Z';

const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.stats',
  'video.list',
  'video.upload',
  'video.publish',
];

function row(
  sync: Record<string, unknown> | undefined,
  connection: Partial<NonNullable<SyncStatusRow['platform_connections']>> = {},
): SyncStatusRow {
  return {
    id: PUBLISH,
    platform: 'tiktok',
    metadata: sync ? { sync } : null,
    platform_connections: {
      scopes: TIKTOK_SCOPES,
      metadata: { scopes_granted_at: GRANTED_BEFORE },
      disconnected_at: null,
      ...connection,
    },
  };
}

describe('describeSyncStatus: what the creator is told', () => {
  it('says nothing is wrong after a successful sync, and when it was', () => {
    const view = describeSyncStatus(
      toSyncStatus(
        row({ last_sync_status: 'success', last_synced_at: SYNCED_AT }),
      ),
    );

    expect(view).toMatchObject({
      state: 'synced',
      lastSyncedAt: SYNCED_AT,
      problem: null,
      reason: null,
      next: null,
    });
  });

  it('never invents a refresh time for a publish that was never synced', () => {
    const view = describeSyncStatus(toSyncStatus(row(undefined)));

    expect(view.state).toBe('not_synced_yet');
    expect(view.lastSyncedAt).toBeNull();
    expect(view.problem).toBeNull();
  });

  it('a rate limit: says so, keeps the last good refresh, and gives TikTok’s reason', () => {
    const view = describeSyncStatus(
      toSyncStatus(
        row({
          last_synced_at: SYNCED_AT,
          last_sync_status: 'rate_limited',
          last_error: 'rate_limit_exceeded: Too many requests.',
          last_failed_at: FAILED_AT,
          consecutive_failures: 1,
        }),
      ),
    );

    expect(view.state).toBe('failed');
    expect(view.lastSyncedAt).toBe(SYNCED_AT);
    expect(view.problem).toBe(
      'TikTok rate-limited the latest sync, so these figures were not refreshed.',
    );
    expect(view.reason).toBe('rate_limit_exceeded: Too many requests.');
    expect(view.next).toBe('It is tried again on the next scheduled sync.');
  });

  it('a refused token: paused until a reconnect, and says that rather than "retrying"', () => {
    const view = describeSyncStatus(
      toSyncStatus(
        row({
          last_synced_at: SYNCED_AT,
          last_sync_status: 'scope_error',
          last_error:
            'access_token_invalid: The access token is invalid or not found in the request.',
          last_failed_at: FAILED_AT,
          consecutive_failures: 1,
          requires_reauth: true,
        }),
      ),
    );

    expect(view.state).toBe('failed');
    expect(view.problem).toBe(
      "TikTok refused the latest sync: it no longer accepts this channel's access.",
    );
    expect(view.reason).toContain('access_token_invalid');
    expect(view.next).toContain('Syncing is paused until the TikTok channel');
  });

  it('a refused token after the creator reconnected: tried again, as the sync decides', () => {
    const status = toSyncStatus(
      row(
        {
          last_sync_status: 'scope_error',
          last_failed_at: FAILED_AT,
          requires_reauth: true,
        },
        { metadata: { scopes_granted_at: GRANTED_AFTER } },
      ),
    );

    expect(status.schedule).toBe('eligible');
    expect(describeSyncStatus(status).next).toBe(
      'It is tried again on the next scheduled sync.',
    );
  });

  it('a 5xx: the generic failure sentence with the platform’s reason', () => {
    const view = describeSyncStatus(
      toSyncStatus(
        row({
          last_sync_status: 'failed',
          last_error:
            'internal_error: The service encountered an unexpected error.',
          consecutive_failures: 2,
        }),
      ),
    );

    expect(view.problem).toBe(
      'The latest sync from TikTok failed, so these figures were not refreshed.',
    );
    expect(view.reason).toBe(
      'internal_error: The service encountered an unexpected error.',
    );
    // Never synced: the failure does not make up a refresh time either.
    expect(view.lastSyncedAt).toBeNull();
  });

  it(`after ${MAX_CONSECUTIVE_FAILURES} failures in a row, says automatic syncing stopped`, () => {
    const view = describeSyncStatus(
      toSyncStatus(
        row({
          last_sync_status: 'failed',
          last_failed_at: FAILED_AT,
          consecutive_failures: MAX_CONSECUTIVE_FAILURES,
        }),
      ),
    );

    expect(view.next).toBe(
      `Automatic syncing stopped after ${MAX_CONSECUTIVE_FAILURES} failed attempts in a row. Reconnect it in Settings → Platforms to start it again.`,
    );
  });

  it('the next successful sync clears it', () => {
    // What the sync writes on success, merged over the failure record.
    const failed: Record<string, unknown> = {
      last_sync_status: 'rate_limited',
      last_error: 'rate_limit_exceeded: Too many requests.',
      consecutive_failures: 1,
    };
    const recovered = {
      ...failed,
      last_synced_at: FAILED_AT,
      last_sync_status: 'success',
      last_error: undefined,
      consecutive_failures: 0,
    };

    const view = describeSyncStatus(toSyncStatus(row(recovered)));

    expect(view.state).toBe('synced');
    expect(view.problem).toBeNull();
    expect(view.reason).toBeNull();
    expect(view.lastSyncedAt).toBe(FAILED_AT);
  });

  it('a disconnected channel and a missing analytics scope are said, not left silent', () => {
    expect(
      describeSyncStatus(
        toSyncStatus(row(undefined, { disconnected_at: FAILED_AT })),
      ).state,
    ).toBe('disconnected');

    const unauthorised = describeSyncStatus(
      toSyncStatus(row(undefined, { scopes: ['user.info.basic'] })),
    );
    expect(unauthorised.state).toBe('not_authorised');
    expect(unauthorised.problem).toContain('has not granted analytics access');
  });

  it('a status the sync never writes is unknown, not a failure', () => {
    const status = toSyncStatus(row({ last_sync_status: 'mystery' }));

    expect(status.lastSyncStatus).toBeNull();
    expect(describeSyncStatus(status).problem).toBeNull();
  });
});

describe('classifySyncFailure: what a failed attempt is recorded as', () => {
  it('records TikTok’s own reason for a rate limit, not this app’s paraphrase', () => {
    const failure = classifySyncFailure(
      new TikTokRateLimitError('rate_limit_exceeded: Too many requests.'),
    );

    expect(failure.status).toBe('rate_limited');
    expect(failure.reason).toBe('rate_limit_exceeded: Too many requests.');
  });

  it('records a refused token as a scope error with TikTok’s reason', () => {
    const failure = classifySyncFailure(
      new TikTokAnalyticsScopeError(undefined, 'access_token_invalid: nope'),
    );

    expect(failure).toMatchObject({
      status: 'scope_error',
      errorType: 'scope',
      reason: 'access_token_invalid: nope',
    });
  });

  it('records a Page without insights access as a scope error, as the other platforms are', () => {
    expect(
      classifySyncFailure(new FacebookInsightsScopeError('(#10) denied')),
    ).toMatchObject({ status: 'scope_error', errorType: 'scope' });
  });

  it('records X’s refused read and rate limit as the other platforms’ are (FILM-1727)', () => {
    expect(classifySyncFailure(new XAnalyticsScopeError())).toMatchObject({
      status: 'scope_error',
      errorType: 'scope',
    });
    expect(classifySyncFailure(new XRateLimitError())).toMatchObject({
      status: 'rate_limited',
      errorType: 'rate_limit',
    });
  });

  it('records anything else as failed, with its message', () => {
    expect(classifySyncFailure(new Error('boom'))).toMatchObject({
      status: 'failed',
      reason: 'boom',
    });
  });
});

describe('TikTok provider: the platform’s reason survives', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  const envelope = (code: string, message: string) =>
    JSON.stringify({ data: {}, error: { code, message, log_id: 'x' } });

  it('a 5xx keeps TikTok’s `code: message`, not the raw JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () =>
        Promise.resolve(
          envelope(
            'internal_error',
            'The service encountered an unexpected error.',
          ),
        ),
    });

    await expect(
      new TikTokAnalyticsProvider('t').getVideoAnalytics({ videoId: 'v' }),
    ).rejects.toThrow(
      /^internal_error: The service encountered an unexpected error\.$/,
    );
  });

  it('a 429 is a rate-limit error carrying TikTok’s reason', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve(envelope('rate_limit_exceeded', 'Too many requests.')),
    });

    const error = await new TikTokAnalyticsProvider('t')
      .getVideoAnalytics({ videoId: 'v' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TikTokRateLimitError);
    expect((error as TikTokRateLimitError).platformReason).toBe(
      'rate_limit_exceeded: Too many requests.',
    );
  });

  it('a 401 is a scope error carrying TikTok’s reason', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(
          envelope('access_token_invalid', 'The access token is invalid.'),
        ),
    });

    const error = await new TikTokAnalyticsProvider('t')
      .getVideoAnalytics({ videoId: 'v' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TikTokAnalyticsScopeError);
    expect((error as TikTokAnalyticsScopeError).platformReason).toBe(
      'access_token_invalid: The access token is invalid.',
    );
  });
});

const read: {
  rows: SyncStatusRow[];
  error: Error | null;
  filters: Array<[string, unknown]>;
  byIds: string[] | null;
} = { rows: [], error: null, filters: [], byIds: null };

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../src/server/analytics-sync-cron', () => ({
  syncSinglePublishById: vi.fn(),
}));

vi.mock('@kit/shared/pagination', () => ({
  fetchAllRows: async (build: (from: number, to: number) => unknown) => {
    build(0, 999);
    if (read.error) throw read.error;
    return read.rows;
  },
  fetchAllByIds: async (
    ids: string[],
    build: (chunk: string[], from: number, to: number) => unknown,
  ) => {
    read.byIds = ids;
    build(ids, 0, 999);
    if (read.error) throw read.error;
    return read.rows;
  },
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'in', 'order', 'range']) {
        chain[method] = (...args: unknown[]) => {
          if (method === 'eq') read.filters.push([args[0] as string, args[1]]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

describe('getSyncStatusAction', () => {
  beforeEach(() => {
    read.rows = [];
    read.error = null;
    read.filters = [];
    read.byIds = null;
  });

  it('returns every synced publish of an episode, as its record says', async () => {
    read.rows = [
      row({
        last_synced_at: SYNCED_AT,
        last_sync_status: 'rate_limited',
        last_error: 'rate_limit_exceeded: Too many requests.',
        consecutive_failures: 1,
      }),
    ];

    const result = await getSyncStatusAction({ episodeId: EPISODE });

    expect(result.ok).toBe(true);
    const [status] = (result as { data: SyncStatusResponse[] }).data;
    expect(status).toMatchObject({
      publishId: PUBLISH,
      lastSyncedAt: SYNCED_AT,
      lastSyncStatus: 'rate_limited',
      lastError: 'rate_limit_exceeded: Too many requests.',
      schedule: 'eligible',
    });
    expect(read.filters).toContainEqual(['episode_id', EPISODE]);
    expect(read.filters).toContainEqual(['status', 'published']);
  });

  it('reads a page of the Video Log by publish id', async () => {
    await getSyncStatusAction({ publishIds: [PUBLISH] });

    expect(read.byIds).toEqual([PUBLISH]);
  });

  it('a failed read is a refusal value, not an empty list', async () => {
    read.error = new Error('connection reset');

    const result = await getSyncStatusAction({ episodeId: EPISODE });

    expect(result).toEqual({
      ok: false,
      error:
        'Could not load the analytics sync status. Try again; if it keeps failing, reload the page.',
    });
  });
});
