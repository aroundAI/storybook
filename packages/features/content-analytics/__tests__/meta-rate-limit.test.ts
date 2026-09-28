import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MetaRateLimitError,
  USAGE_CEILING,
  metaUsagePercent,
} from '../src/lib/meta-usage';
import { InstagramInsightsProvider } from '../src/providers/instagram/instagram-insights';

vi.mock('server-only', () => ({}));

/**
 * Meta's rate limits (Graph API rate-limiting reference): the nightly reach
 * sync reads how much of the hourly allowance it has used and stops a
 * channel before Meta does, and a throttled channel is paused, not failed.
 */

const headers = (entries: Record<string, string>) => new Headers(entries);

describe('metaUsagePercent', () => {
  it("takes the worst figure of Instagram's business-use-case entry", () => {
    expect(
      metaUsagePercent(
        headers({
          'x-business-use-case-usage': JSON.stringify({
            '1234': [
              {
                type: 'instagram',
                call_count: 42,
                total_cputime: 71,
                total_time: 9,
              },
            ],
          }),
        }),
      ),
    ).toBe(71);
  });

  it('reads X-App-Usage too, and the higher of the two decides', () => {
    expect(
      metaUsagePercent(
        headers({
          'x-business-use-case-usage': JSON.stringify({
            '1': [{ type: 'instagram', call_count: 30 }],
          }),
          'x-app-usage': JSON.stringify({ call_count: 88, total_time: 1 }),
        }),
      ),
    ).toBe(88);
  });

  it('is null — not 0 — when neither header is there or readable', () => {
    expect(metaUsagePercent(headers({}))).toBeNull();
    expect(metaUsagePercent(headers({ 'x-app-usage': 'not json' }))).toBeNull();
  });
});

describe('InstagramInsightsProvider and the rate limit', () => {
  afterEach(() => vi.unstubAllGlobals());

  const bounds = {
    since: new Date('2026-09-21T00:00:00Z'),
    until: new Date('2026-09-28T00:00:00Z'),
  };

  it('records the usage every reach call reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ name: 'reach', total_value: { value: 5 } }],
            }),
            {
              headers: {
                'x-business-use-case-usage': JSON.stringify({
                  '1': [{ type: 'instagram', call_count: 64 }],
                }),
              },
            },
          ),
      ),
    );

    const provider = new InstagramInsightsProvider('token', 'ig-1');
    expect(provider.usagePercent).toBeNull();
    await provider.getAccountReach(bounds);
    expect(provider.usagePercent).toBe(64);
  });

  it("turns Instagram's throttle (code 80002) into MetaRateLimitError", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'Application request limit reached',
                type: 'OAuthException',
                code: 80002,
              },
            }),
            { status: 400 },
          ),
      ),
    );

    await expect(
      new InstagramInsightsProvider('token', 'ig-1').getAccountReach(bounds),
    ).rejects.toBeInstanceOf(MetaRateLimitError);
  });
});

// ---- the nightly capture, its reads and writes mocked -----------------------

const inserted: unknown[][] = [];

vi.mock('@kit/clickhouse/server', () => ({
  isClickHouseEnabled: () => true,
  queryCompleteChannelWindowDays: async () => new Set<string>(),
  insertChannelWindows: async (rows: unknown[]) => {
    inserted.push(rows);
  },
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              range: async (from: number) => ({
                data:
                  from === 0
                    ? [
                        { id: 'conn-busy', platform_account_id: 'ig-busy' },
                        {
                          id: 'conn-throttled',
                          platform_account_id: 'ig-throttled',
                        },
                        { id: 'conn-quiet', platform_account_id: 'ig-quiet' },
                      ]
                    : [],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@kit/publishing/token-refresh', () => ({
  ensureValidToken: async (connectionId: string) => ({
    valid: true,
    accessToken: `token-${connectionId}`,
  }),
}));

describe('captureChannelReachWindows under the rate limit', () => {
  beforeEach(() => {
    inserted.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const account = new URL(input).pathname.split('/').at(-2);
        if (account === 'ig-throttled') {
          return new Response(
            JSON.stringify({ error: { message: 'limit', code: 80002 } }),
            { status: 400 },
          );
        }
        const usage = account === 'ig-busy' ? USAGE_CEILING + 5 : 12;
        return new Response(
          JSON.stringify({
            data: [{ name: 'reach', total_value: { value: 9 } }],
          }),
          {
            headers: {
              'x-business-use-case-usage': JSON.stringify({
                '1': [{ type: 'instagram', call_count: usage }],
              }),
            },
          },
        );
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pauses a channel at the ceiling, counts a throttle as paused, and carries on', async () => {
    const { captureChannelReachWindows, BACKFILL_DAYS, REACH_WINDOWS } =
      await import('../src/server/channel-reach-windows');

    const result = await captureChannelReachWindows(
      new Date('2026-09-28T02:30:00Z'),
      60_000,
    );

    // busy: one day, then paused at the ceiling. throttled: refused, paused.
    // quiet: its whole backlog.
    expect(result.throttled).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.rowsWritten).toBe((1 + BACKFILL_DAYS) * REACH_WINDOWS.length);
  });
});
