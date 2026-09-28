import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstagramInsightsProvider } from '../src/providers/instagram/instagram-insights';

/**
 * FILM-1712 part B. A post's `reach` is requested; when Meta leaves it out
 * it was stored as 0, which reads as "reached nobody". Not measured is null.
 */
function stubGraph(insights: Array<{ name: string; value: number }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);

      if (url.searchParams.get('fields')) {
        return new Response(
          JSON.stringify({ media_type: 'VIDEO', media_product_type: 'REELS' }),
        );
      }

      if (url.pathname.endsWith('/m1/insights')) {
        return new Response(
          JSON.stringify({
            data: insights.map(({ name, value }) => ({
              name,
              values: [{ value }],
            })),
          }),
        );
      }

      return new Response(JSON.stringify({ data: [] }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Instagram post reach (FILM-1712 part B)', () => {
  it('keeps the reach Meta reports', async () => {
    stubGraph([
      { name: 'views', value: 900 },
      { name: 'reach', value: 640 },
    ]);

    const result = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getMediaInsights({ mediaId: 'm1' });

    expect(result.totals.reach).toBe(640);
  });

  it('is null, not 0, when Meta leaves reach out', async () => {
    stubGraph([{ name: 'views', value: 900 }]);

    const result = await new InstagramInsightsProvider(
      'token',
      'ig-1',
    ).getMediaInsights({ mediaId: 'm1' });

    expect(result.totals.views).toBe(900);
    expect(result.totals.reach).toBeNull();
  });
});
