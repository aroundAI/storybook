import { google } from 'googleapis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstagramInsightsProvider } from '../src/providers/instagram/instagram-insights';
import {
  YouTubeAnalyticsProvider,
  totalTrafficSources,
} from '../src/providers/youtube/youtube-analytics';
import {
  buildInstagramAccountDayRows,
  buildYouTubeChannelDayRows,
  buildYouTubeLifetimeRow,
} from '../src/server/channel-totals';
import {
  buildYouTubeSnapshotRows,
  buildYouTubeTrafficRows,
} from '../src/server/ingest';
import { lastDataDate } from '../src/server/sync-status';

/**
 * FILM-1734. What StoryBook now collects so a morning report needs nothing
 * else: YouTube's live counts and dislikes, its whole-channel days and
 * lifetime statistics, the Analytics API's traffic sources by day,
 * Instagram's per-post follows and profile visits and its account's day,
 * and each publish's data date. A count a platform withholds is null, never 0.
 */

vi.mock('@kit/clickhouse/server', async () => ({
  ...(await vi.importActual<object>('@kit/clickhouse')),
  formatDateStr: (date: Date) => date.toISOString().slice(0, 10),
  insertChannelMetricsDaily: vi.fn(),
  insertChannelWindows: vi.fn(),
}));
vi.mock('@kit/supabase/server-admin-client', () => ({}));

vi.mock('googleapis', () => {
  const reportsQuery = vi.fn();
  const videosList = vi.fn();
  const channelsList = vi.fn();

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })),
      },
      youtubeAnalytics: vi.fn(() => ({ reports: { query: reportsQuery } })),
      youtube: vi.fn(() => ({
        videos: { list: videosList },
        channels: { list: channelsList },
      })),
    },
  };
});

const youtube = (
  google.youtube as unknown as () => {
    videos: { list: ReturnType<typeof vi.fn> };
    channels: { list: ReturnType<typeof vi.fn> };
  }
)();
const analytics = (
  google.youtubeAnalytics as unknown as () => {
    reports: { query: ReturnType<typeof vi.fn> };
  }
)();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('YouTube live counts (videos.list part=statistics)', () => {
  const provider = new YouTubeAnalyticsProvider('token');

  it('asks for statistics, at most 50 ids a call', async () => {
    youtube.videos.list.mockResolvedValue({ data: { items: [] } });
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);

    await provider.fetchVideoStatistics(ids);

    expect(youtube.videos.list).toHaveBeenCalledTimes(3);
    for (const [request] of youtube.videos.list.mock.calls) {
      expect(request.part).toEqual(['statistics']);
      expect(request.id.length).toBeLessThanOrEqual(50);
    }
  });

  it('reads dislikes for the owner, and a withheld count as null, never 0', async () => {
    youtube.videos.list.mockResolvedValue({
      data: {
        items: [
          {
            id: 'owned',
            statistics: {
              viewCount: '1300',
              likeCount: '55',
              dislikeCount: '4',
              commentCount: '10',
            },
          },
          // Likes hidden, comments off, no dislikes for this token.
          { id: 'withheld', statistics: { viewCount: '20' } },
        ],
      },
    });

    const stats = await provider.fetchVideoStatistics(['owned', 'withheld']);

    expect(stats.get('owned')).toEqual({
      videoId: 'owned',
      views: 1300,
      likes: 55,
      dislikes: 4,
      comments: 10,
    });
    expect(stats.get('withheld')).toEqual({
      videoId: 'withheld',
      views: 20,
      likes: null,
      dislikes: null,
      comments: null,
    });
  });
});

describe('YouTube channel totals', () => {
  const provider = new YouTubeAnalyticsProvider('token');

  it('reads lifetime statistics by channel id; a hidden subscriber count is null', async () => {
    youtube.channels.list.mockResolvedValue({
      data: {
        items: [
          {
            statistics: {
              viewCount: '90000',
              subscriberCount: '1200',
              hiddenSubscriberCount: true,
              videoCount: '30',
            },
          },
        ],
      },
    });

    expect(await provider.getChannelStatistics('UC1')).toEqual({
      views: 90000,
      subscribers: null,
      videos: 30,
    });
    expect(youtube.channels.list.mock.calls[0]![0]).toMatchObject({
      part: ['statistics'],
      id: ['UC1'],
    });
  });

  it('asks for the whole channel by day, with no video filter; a missing metric is null', async () => {
    analytics.reports.query.mockResolvedValue({
      data: {
        columnHeaders: ['day', 'views', 'estimatedMinutesWatched', 'likes'].map(
          (name) => ({ name }),
        ),
        rows: [['2026-10-11', 5000, 1500, 200]],
      },
    });

    const days = await provider.getChannelDailyMetrics(
      'UC1',
      new Date('2026-10-05T00:00:00Z'),
      new Date('2026-10-12T00:00:00Z'),
    );
    const request = analytics.reports.query.mock.calls[0]![0];

    expect(request.ids).toBe('channel==UC1');
    expect(request.dimensions).toBe('day');
    expect(request.filters).toBeUndefined();
    expect(request.metrics.split(',')).toEqual(
      expect.arrayContaining(['dislikes', 'subscribersLost', 'shares']),
    );
    expect(days).toEqual([
      {
        date: '2026-10-11',
        views: 5000,
        estimatedMinutesWatched: 1500,
        likes: 200,
        dislikes: null,
        comments: null,
        shares: null,
        subscribersGained: null,
        subscribersLost: null,
      },
    ]);
  });

  it('a channel day is stored from the Analytics API, its lifetime from the Data API', () => {
    const [day] = buildYouTubeChannelDayRows('c1', [
      {
        date: '2026-10-11',
        views: 5000,
        estimatedMinutesWatched: 1500,
        likes: 200,
        dislikes: null,
        comments: 30,
        shares: 12,
        subscribersGained: 15,
        subscribersLost: 3,
      },
    ]);

    expect(day).toMatchObject({
      source: 'analytics_api',
      watch_time_seconds: 90000,
      dislikes: null,
      lifetime_views: null,
    });
    expect(
      buildYouTubeLifetimeRow('c1', '2026-10-11', {
        views: 90000,
        subscribers: null,
        videos: 30,
      }),
    ).toMatchObject({
      source: 'data_api',
      views: null,
      lifetime_views: 90000,
      lifetime_subscribers: null,
      lifetime_videos: 30,
    });
  });
});

describe('YouTube snapshots and traffic, as stored', () => {
  it('one data_api snapshot per answered video, under its publish id; what YouTube does not count is null', () => {
    const rows = buildYouTubeSnapshotRows({
      projectId: 'p1',
      snapshotDate: '2026-10-11',
      publishIdByVideoId: new Map([
        ['yt-a', 'publish-a'],
        ['yt-gone', 'publish-gone'],
      ]),
      statistics: new Map([
        [
          'yt-a',
          {
            videoId: 'yt-a',
            views: 1300,
            likes: 55,
            dislikes: null,
            comments: 10,
          },
        ],
      ]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      video_id: 'publish-a',
      platform: 'youtube',
      source: 'data_api',
      views: 1300,
      dislikes: null,
      shares: null,
      watch_time_seconds: null,
    });
  });

  it('traffic sources by day, as the Analytics API’s own copy', () => {
    const days = [
      {
        date: '2026-10-10',
        source: 'YT_SEARCH',
        views: 30,
        watchTimeMinutes: 9,
      },
      {
        date: '2026-10-11',
        source: 'YT_SEARCH',
        views: 40,
        watchTimeMinutes: 12,
      },
      { date: '2026-10-11', source: 'EXT_URL', views: 5, watchTimeMinutes: 1 },
    ];

    expect(
      buildYouTubeTrafficRows({ projectId: 'p1', videoId: 'v1', days }).map(
        (row) => [row.metric_date, row.source, row.metric_source],
      ),
    ).toEqual([
      ['2026-10-10', 'YT_SEARCH', 'analytics_api'],
      ['2026-10-11', 'YT_SEARCH', 'analytics_api'],
      ['2026-10-11', 'EXT_URL', 'analytics_api'],
    ]);
    expect(totalTrafficSources(days)).toEqual([
      { source: 'YT_SEARCH', views: 70, watchTimeMinutes: 21 },
      { source: 'EXT_URL', views: 5, watchTimeMinutes: 1 },
    ]);
  });

  it('asks the Analytics API for traffic sources by day', async () => {
    analytics.reports.query.mockResolvedValue({ data: { rows: [] } });

    await new YouTubeAnalyticsProvider('token').getVideoAnalytics({
      videoId: 'v1',
      startDate: new Date('2026-10-08T00:00:00Z'),
      endDate: new Date('2026-10-11T00:00:00Z'),
      publishedAt: new Date('2024-06-01'),
    });

    const traffic = analytics.reports.query.mock.calls
      .map(([request]) => request)
      .find((request) =>
        request.dimensions.includes('insightTrafficSourceType'),
      );

    expect(traffic.dimensions).toBe('day,insightTrafficSourceType');
  });
});

describe('Instagram account day', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  it('asks for one UTC day of views and reach; a figure Meta leaves out is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          data: [{ name: 'views', total_value: { value: 800 } }],
        }),
    });

    const day = await new InstagramInsightsProvider('t', 'ig1').getAccountDay(
      '2026-10-11',
    );
    const url = new URL(mockFetch.mock.calls[0]![0] as string);

    expect(day).toEqual({ date: '2026-10-11', views: 800, reach: null });
    expect(url.searchParams.get('since')).toBe(
      String(Date.parse('2026-10-11T00:00:00Z') / 1000),
    );
    expect(
      Number(url.searchParams.get('until')) -
        Number(url.searchParams.get('since')),
    ).toBe(86_400);
  });

  it('views to channel_metrics_daily, reach to a 1-day channel window, and nothing for a null', () => {
    expect(
      buildInstagramAccountDayRows('c2', {
        date: '2026-10-11',
        views: 800,
        reach: 77,
      }),
    ).toMatchObject({
      metrics: [{ source: 'graph_api', views: 800, platform: 'instagram' }],
      windows: [{ windowDays: 1, accountsReached: 77, asOf: '2026-10-11' }],
    });
    expect(
      buildInstagramAccountDayRows('c2', {
        date: '2026-10-11',
        views: null,
        reach: null,
      }),
    ).toEqual({ metrics: [], windows: [] });
  });

  it('a Reel is never asked for follows or profile visits; a feed post is', async () => {
    const asked = async (surface: string) => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              media_type: 'VIDEO',
              media_product_type: surface,
            }),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });

      const result = await new InstagramInsightsProvider(
        't',
        'ig1',
      ).getMediaInsights({ mediaId: 'm1' });
      const insights = mockFetch.mock.calls
        .map(([url]) => new URL(url as string))
        .find((u) => u.pathname.endsWith('/m1/insights'))!;

      return {
        metrics: insights.searchParams.get('metric')!.split(','),
        follows: result.totals.follows,
      };
    };

    const reel = await asked('REELS');
    const feed = await asked('FEED');

    expect(reel.metrics).not.toContain('follows');
    expect(reel.metrics).not.toContain('profile_visits');
    expect(reel.follows).toBeNull();
    expect(feed.metrics).toEqual(
      expect.arrayContaining(['follows', 'profile_visits']),
    );
  });
});

describe('lastDataDate', () => {
  it('YouTube: the last day its Analytics API reported, not the sync time', () => {
    expect(
      lastDataDate('youtube', {
        last_synced_at: '2026-10-12T05:00:00Z',
        last_data_date: '2026-10-10',
      }),
    ).toBe('2026-10-10');
    expect(
      lastDataDate('youtube', { last_synced_at: '2026-10-12T05:00:00Z' }),
    ).toBeNull();
  });

  it('a lifetime-counter platform: the day its counts were read', () => {
    expect(
      lastDataDate('instagram', { last_synced_at: '2026-10-12T05:00:00Z' }),
    ).toBe('2026-10-12');
    expect(lastDataDate('instagram', undefined)).toBeNull();
  });
});
