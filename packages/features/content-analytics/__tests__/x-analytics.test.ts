import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  XAnalyticsProvider,
  XAnalyticsScopeError,
  XPostNotFoundError,
  XRateLimitError,
} from '../src/providers/twitter/x-analytics';

/**
 * FILM-1727: the X provider reads one post, once, and what X leaves out is
 * never turned into a zero.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

const PUBLIC = {
  retweet_count: 12,
  reply_count: 4,
  like_count: 90,
  quote_count: 2,
  bookmark_count: 7,
  impression_count: 4000,
};

function lookup(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const post = (overrides: Record<string, unknown> = {}) => ({
  data: [
    {
      id: '1900',
      public_metrics: PUBLIC,
      attachments: { media_keys: ['7_1900'] },
      ...overrides,
    },
  ],
  includes: {
    media: [
      {
        media_key: '7_1900',
        type: 'video',
        public_metrics: { view_count: 1000 },
        non_public_metrics: {
          playback_0_count: 1000,
          playback_25_count: 700,
          playback_50_count: 480,
          playback_75_count: 300,
          playback_100_count: 150,
        },
      },
    ],
  },
});

describe('XAnalyticsProvider', () => {
  beforeEach(() => mockFetch.mockReset());

  it('asks the posts lookup once, for public and non-public metrics only', async () => {
    lookup(post());
    const result = await new XAnalyticsProvider('t').getPostAnalytics('1900');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = String(mockFetch.mock.calls[0]![0]);
    expect(url).toContain('/2/tweets?ids=1900');
    expect(url).toContain('tweet.fields=public_metrics');
    expect(url).toContain('media.fields=public_metrics,non_public_metrics');
    expect(url).not.toContain('analytics');

    expect(result).toEqual({
      postId: '1900',
      totals: {
        views: 1000,
        likes: 90,
        replies: 4,
        reposts: 12,
        bookmarks: 7,
      },
      quartiles: {
        started: 1000,
        quarter: 700,
        half: 480,
        threeQuarters: 300,
        complete: 150,
      },
    });
  });

  it('gives no quartiles, not zero quartiles, when X leaves the non-public group out', async () => {
    const body = post();
    delete (body.includes.media[0] as Record<string, unknown>)
      .non_public_metrics;
    lookup(body);

    const result = await new XAnalyticsProvider('t').getPostAnalytics('1900');
    expect(result.quartiles).toBeNull();
  });

  it('gives no views for a post without a video', async () => {
    lookup({ data: [{ id: '1900', public_metrics: PUBLIC }] });

    const result = await new XAnalyticsProvider('t').getPostAnalytics('1900');
    expect(result.totals.views).toBeNull();
    expect(result.quartiles).toBeNull();
  });

  it('refuses a response missing a required public metric rather than reading 0', async () => {
    const { like_count: _dropped, ...partial } = PUBLIC;
    lookup(post({ public_metrics: partial }));

    await expect(
      new XAnalyticsProvider('t').getPostAnalytics('1900'),
    ).rejects.toThrow(/without public_metrics like_count/);
  });

  it('names a deleted post, a refused token and a rate limit apart', async () => {
    lookup({ errors: [{ title: 'Not Found Error', resource_id: '1900' }] });
    await expect(
      new XAnalyticsProvider('t').getPostAnalytics('1900'),
    ).rejects.toBeInstanceOf(XPostNotFoundError);

    lookup({ title: 'Unauthorized' }, 401);
    await expect(
      new XAnalyticsProvider('t').getPostAnalytics('1900'),
    ).rejects.toBeInstanceOf(XAnalyticsScopeError);

    lookup({ title: 'Too Many Requests' }, 429);
    await expect(
      new XAnalyticsProvider('t').getPostAnalytics('1900'),
    ).rejects.toBeInstanceOf(XRateLimitError);
  });
});
