import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1726. Facebook's ad-break earnings are asked for in a read of their
 * own. Meta answers earnings only to the admin of a Page that runs ad
 * breaks, so a refusal must cost those four figures and nothing else, and
 * must say which kind of refusal it was.
 */
const metaFetch = vi.fn();

vi.mock('@kit/shared/vendors', () => ({
  metaFetch: (...args: unknown[]) => metaFetch(...args),
}));

const { FacebookInsightsProvider } = await import(
  '../src/providers/facebook/facebook-insights'
);

const AD_BREAK = /total_video_ad_break_earnings/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function insights(values: Record<string, number>) {
  return json({
    data: Object.entries(values).map(([name, value]) => ({
      name,
      values: [{ value }],
    })),
  });
}

function answer(adBreaks: () => Response) {
  metaFetch.mockImplementation(async (path: string) => {
    if (AD_BREAK.test(decodeURIComponent(path))) return adBreaks();
    if (path.includes('/video_insights?')) {
      return insights({ total_video_views: 800 });
    }
    if (path.includes('?fields=post_id')) {
      return json({
        post_id: 'post-1',
        comments: { summary: { total_count: 3 } },
      });
    }
    if (path.includes('?fields=shares')) return json({ shares: { count: 2 } });
    return json({ data: [] });
  });
}

describe('Facebook ad-break earnings (FILM-1726)', () => {
  beforeEach(() => {
    metaFetch.mockReset();
  });

  it('asks for the four ad-break metrics in a read of their own', async () => {
    answer(() =>
      insights({
        total_video_ad_break_earnings: 1234,
        total_video_ad_break_ad_cpm: 5.5,
        total_video_ad_break_ad_impressions: 900,
        creator_monetization_qualified_views: 700,
      }),
    );

    const result = await new FacebookInsightsProvider('token').getVideoInsights(
      { videoId: 'v1' },
    );

    const adBreakReads = metaFetch.mock.calls
      .map(([path]) => decodeURIComponent(path as string))
      .filter((path) => AD_BREAK.test(path));

    expect(adBreakReads).toHaveLength(1);
    expect(adBreakReads[0]).toContain(
      'metric=total_video_ad_break_earnings,total_video_ad_break_ad_cpm,total_video_ad_break_ad_impressions,creator_monetization_qualified_views',
    );
    expect(result.adBreaks).toEqual({
      access: 'authorised',
      earnings: 1234,
      cpm: 5.5,
      adImpressions: 900,
      qualifiedViews: 700,
    });
    expect(result.totals.threeSecondViews).toBe(800);
  });

  it('reads a permission refusal as the Page’s, and keeps every other figure', async () => {
    answer(() => json({ error: { code: 200, message: 'Admins only' } }, 403));

    const result = await new FacebookInsightsProvider('token').getVideoInsights(
      { videoId: 'v1' },
    );

    expect(result.adBreaks).toEqual({
      access: 'account_type_gated',
      earnings: null,
      cpm: null,
      adImpressions: null,
      qualifiedViews: null,
    });
    expect(result.totals.threeSecondViews).toBe(800);
    expect(result.totals.comments).toBe(3);
  });

  it('reads any other refusal as unavailable, never as an access state', async () => {
    answer(() =>
      json({ error: { code: 100, message: 'Invalid metric' } }, 400),
    );

    const result = await new FacebookInsightsProvider('token').getVideoInsights(
      { videoId: 'v1' },
    );

    expect(result.adBreaks.access).toBe('unavailable');
    expect(result.adBreaks.earnings).toBeNull();
  });
});
