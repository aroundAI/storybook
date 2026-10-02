import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { USAGE_CEILING } from '../src/lib/meta-usage';

vi.mock('server-only', () => ({}));

/**
 * FILM-1720: a Page's unique viewers, recorded nightly. A day is complete
 * once written and never asked for again, so a day Meta has not finished,
 * or refused, must not be written at all.
 */

const inserted: { asOf: string; accountsReached: number | null }[][] = [];

vi.mock('@kit/clickhouse/server', () => ({
  isClickHouseEnabled: () => true,
  queryCompleteChannelWindowDays: async () => new Set<string>(),
  insertChannelWindows: async (
    rows: { asOf: string; accountsReached: number | null }[],
  ) => {
    inserted.push(rows);
  },
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              range: async (from: number) => ({
                data:
                  from === 0
                    ? [
                        {
                          id: 'conn-page',
                          platform: 'facebook',
                          platform_account_id: 'page-1',
                          scopes: ['read_insights', 'pages_read_engagement'],
                        },
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
  ensureValidToken: async () => ({ valid: true, accessToken: 'page-token' }),
}));

/** Meta's answer per period; `null` is an empty `data`. */
let answer: (period: string) => number | null | 'refused';
let usage = 10;

beforeEach(() => {
  inserted.length = 0;
  usage = 10;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const period = new URL(input).searchParams.get('period')!;
      const value = answer(period);
      const headers = {
        'x-business-use-case-usage': JSON.stringify({
          '1': [{ type: 'pages', call_count: usage }],
        }),
      };
      if (value === 'refused') {
        return new Response(
          JSON.stringify({ error: { message: 'not yet', code: 100 } }),
          { status: 400, headers },
        );
      }
      return new Response(
        JSON.stringify({
          data:
            value === null
              ? []
              : [
                  {
                    name: 'page_total_media_view_unique',
                    values: [{ value }],
                  },
                ],
        }),
        { headers },
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function capture() {
  const { captureChannelReachWindows } = await import(
    '../src/server/channel-reach-windows'
  );
  return captureChannelReachWindows(new Date('2026-09-28T02:30:00Z'), 60_000);
}

describe('captureChannelReachWindows for a Facebook Page', () => {
  it('records a day only when every window has a figure', async () => {
    answer = (period) => ({ day: 60, week: 250, days_28: 900 })[period]!;
    const { BACKFILL_DAYS } = await import(
      '../src/server/channel-reach-windows'
    );

    const result = await capture();

    expect(result.failed).toBe(0);
    expect(result.rowsWritten).toBe(BACKFILL_DAYS * 3);
    expect(inserted[0]!.map((row) => row.accountsReached)).toEqual([
      60, 250, 900,
    ]);
  });

  it('writes nothing for a day Meta has not finished, so it is asked again', async () => {
    answer = (period) => (period === 'days_28' ? null : 1);

    const result = await capture();

    expect(inserted).toEqual([]);
    expect(result.failed).toBe(1);
  });

  it('writes nothing for a day Meta refused', async () => {
    answer = (period) => (period === 'week' ? 'refused' : 1);

    const result = await capture();

    expect(inserted).toEqual([]);
    expect(result.failed).toBe(1);
  });

  it("stops the Page's backlog at the usage ceiling", async () => {
    answer = () => 5;
    usage = USAGE_CEILING + 1;

    const result = await capture();

    expect(inserted).toHaveLength(1);
    expect(result.throttled).toBe(1);
  });
});
