import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstagramInsightsProvider } from '../src/providers/instagram/instagram-insights';

/**
 * FILM-1712. The audience call asked for all four demographic breakdowns at
 * once with no `timeframe`, and its parsers looked for items named
 * `country`, `city`, `age` or `gender`. Meta documents one breakdown per
 * request with a required timeframe, and answers with one item named
 * `follower_demographics`, so every audience list came back empty.
 */

const ROWS: Record<string, Array<[string, number]>> = {
  country: [
    ['IN', 40],
    ['US', 60],
  ],
  city: [['Mumbai, Maharashtra', 12]],
  age: [
    ['18-24', 30],
    ['25-34', 70],
  ],
  gender: [
    ['F', 55],
    ['M', 45],
  ],
};

type Answer = (breakdown: string) => Response;

function demographics(breakdown: string) {
  return {
    data: [
      {
        name: 'follower_demographics',
        total_value: {
          breakdowns: [
            {
              dimension_keys: [breakdown],
              results: (ROWS[breakdown] ?? []).map(([value, count]) => ({
                dimension_values: [value],
                value: count,
              })),
            },
          ],
        },
      },
    ],
  };
}

const ok: Answer = (breakdown) =>
  new Response(JSON.stringify(demographics(breakdown)));

function stubGraph(answer: Answer) {
  const audienceCalls: URLSearchParams[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);

      if (url.searchParams.get('metric') === 'follower_demographics') {
        audienceCalls.push(url.searchParams);
        return answer(url.searchParams.get('breakdown') ?? '');
      }
      if (url.searchParams.get('fields')) {
        return new Response(
          JSON.stringify({ media_type: 'VIDEO', media_product_type: 'REELS' }),
        );
      }
      return new Response(JSON.stringify({ data: [] }));
    }),
  );

  return audienceCalls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Instagram audience, as Meta documents it (FILM-1712)', () => {
  it('asks once per breakdown, each with a timeframe v20+ accepts', async () => {
    const calls = stubGraph(ok);

    await new InstagramInsightsProvider('token', 'ig-1').getMediaInsights({
      mediaId: 'm1',
    });

    expect(calls.map((c) => c.get('breakdown')).sort()).toEqual([
      'age',
      'city',
      'country',
      'gender',
    ]);
    for (const call of calls) {
      expect(call.get('timeframe')).toMatch(/^(this_month|this_week)$/);
      expect(call.get('period')).toBe('lifetime');
      expect(call.get('metric_type')).toBe('total_value');
    }
  });

  it('reads the rows out of the follower_demographics item', async () => {
    stubGraph(ok);

    const result = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getMediaInsights({ mediaId: 'm1' });

    expect(result.audience).toEqual({
      countries: [
        { country: 'US', count: 60 },
        { country: 'IN', count: 40 },
      ],
      cities: [{ city: 'Mumbai, Maharashtra', count: 12 }],
      ages: [
        { ageGroup: '25-34', count: 70 },
        { ageGroup: '18-24', count: 30 },
      ],
      genders: [
        { gender: 'F', count: 55 },
        { gender: 'M', count: 45 },
      ],
    });
  });

  it('a refused breakdown loses only its own list', async () => {
    stubGraph((breakdown) =>
      breakdown === 'city'
        ? new Response(JSON.stringify({ error: { message: 'no' } }), {
            status: 400,
          })
        : ok(breakdown),
    );

    const result = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getMediaInsights({ mediaId: 'm1' });

    expect(result.audience?.cities).toEqual([]);
    expect(result.audience?.countries).toHaveLength(2);
  });

  it('with every breakdown refused, there is no audience', async () => {
    stubGraph(() => new Response('{}', { status: 400 }));

    const result = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getMediaInsights({ mediaId: 'm1' });

    expect(result.audience).toBeUndefined();
  });
});
