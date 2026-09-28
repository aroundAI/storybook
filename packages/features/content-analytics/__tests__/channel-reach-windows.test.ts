import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstagramInsightsProvider } from '../src/providers/instagram/instagram-insights';
import {
  BACKFILL_DAYS,
  REACH_WINDOWS,
  missingAsOfDays,
  reachWindowBounds,
} from '../src/server/channel-reach-windows';

vi.mock('server-only', () => ({}));

/**
 * Unique reach per channel and window (migration 016). A unique count cannot
 * be built from days, so each window is Meta's own answer; these pin which
 * days are asked for, which days are still missing, and that a figure Meta
 * leaves out is null.
 */
const iso = (date: Date) => date.toISOString();
const window = (days: number) =>
  REACH_WINDOWS.find((w) => w.windowDays === days)!;

describe('reachWindowBounds', () => {
  it('asks for the 7 complete days ending on as_of', () => {
    const { since, until } = reachWindowBounds('2026-09-27', window(7));

    expect(iso(since)).toBe('2026-09-21T00:00:00.000Z');
    expect(iso(until)).toBe('2026-09-28T00:00:00.000Z');
  });

  it('asks for the 30 complete days ending on as_of', () => {
    const { since, until } = reachWindowBounds('2026-09-27', window(30));

    expect(iso(since)).toBe('2026-08-29T00:00:00.000Z');
    expect(iso(until)).toBe('2026-09-28T00:00:00.000Z');
  });

  // 30-day reach minus this is "new in the last 7 days", so the two windows
  // must together cover exactly the 30 days, without overlap.
  it('asks for the 23 days before the last 7, meeting the 7-day window', () => {
    const before = reachWindowBounds('2026-09-27', window(23));
    const last7 = reachWindowBounds('2026-09-27', window(7));
    const all30 = reachWindowBounds('2026-09-27', window(30));

    expect(iso(before.since)).toBe(iso(all30.since));
    expect(iso(before.until)).toBe(iso(last7.since));
  });

  it('crosses a month boundary by calendar days', () => {
    const { since } = reachWindowBounds('2026-03-02', window(7));

    expect(iso(since)).toBe('2026-02-24T00:00:00.000Z');
  });
});

describe('missingAsOfDays', () => {
  it('lists every day from yesterday back 60 days when nothing is recorded', () => {
    const days = missingAsOfDays('2026-09-28', new Set());

    expect(days).toHaveLength(BACKFILL_DAYS);
    expect(days[0]).toBe('2026-09-27');
    expect(days.at(-1)).toBe('2026-07-30');
  });

  it('skips days already complete, newest first', () => {
    const days = missingAsOfDays(
      '2026-09-28',
      new Set(['2026-09-27', '2026-09-25']),
    );

    expect(days.slice(0, 2)).toEqual(['2026-09-26', '2026-09-24']);
    expect(days).not.toContain('2026-09-27');
    expect(days).not.toContain('2026-09-25');
  });

  it('never asks for today, which is not complete', () => {
    expect(missingAsOfDays('2026-09-28', new Set())).not.toContain(
      '2026-09-28',
    );
  });
});

describe('InstagramInsightsProvider.getAccountReach', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubReach(
    total: { value?: number } | null,
    split: Array<[string, number]>,
  ) {
    const calls: URLSearchParams[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const params = new URL(input).searchParams;
        calls.push(params);

        if (params.get('breakdown') === 'follow_type') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  name: 'reach',
                  total_value: {
                    breakdowns: [
                      {
                        results: split.map(([type, value]) => ({
                          dimension_values: [type],
                          value,
                        })),
                      },
                    ],
                  },
                },
              ],
            }),
          );
        }

        return new Response(
          JSON.stringify({
            data: total ? [{ name: 'reach', total_value: total }] : [],
          }),
        );
      }),
    );

    return calls;
  }

  const bounds = reachWindowBounds('2026-09-27', window(30));

  it('returns the window total and the follower split', async () => {
    const calls = stubReach({ value: 170 }, [
      ['FOLLOWER', 40],
      ['NON_FOLLOWER', 125],
    ]);

    const reach = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getAccountReach(bounds);

    expect(reach).toEqual({
      accountsReached: 170,
      followers: 40,
      nonFollowers: 125,
    });

    for (const call of calls) {
      expect(call.get('metric')).toBe('reach');
      expect(call.get('metric_type')).toBe('total_value');
      expect(call.get('since')).toBe(String(bounds.since.getTime() / 1000));
      expect(call.get('until')).toBe(String(bounds.until.getTime() / 1000));
    }
  });

  it('is null, not 0, when Meta leaves the figures out', async () => {
    stubReach(null, []);

    const reach = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getAccountReach(bounds);

    expect(reach).toEqual({
      accountsReached: null,
      followers: null,
      nonFollowers: null,
    });
  });
});
