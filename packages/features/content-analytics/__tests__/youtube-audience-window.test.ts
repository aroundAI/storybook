import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-212. The audience breakdowns were asked over the sync's window — the
 * last data date minus three days to now — and stored as the video's
 * audience, so a month-old video's "audience" was its last four days. They
 * now run from the publish date. And six of the optional queries swallowed
 * every failure, a missing scope included, in a bare catch: they now log a
 * refusal and rethrow a scope or quota error, as traffic and geography do.
 */
const query = vi.fn();
const warn = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })),
    },
    youtubeAnalytics: vi.fn(() => ({ reports: { query } })),
    youtube: vi.fn(() => ({ videos: { list: vi.fn() } })),
  },
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn, info: vi.fn(), error: vi.fn() }),
}));

const { YouTubeAnalyticsProvider, YouTubeAnalyticsScopeError } = await import(
  '../src/providers/youtube/youtube-analytics'
);

type Params = {
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
};

const AUDIENCE_DIMENSIONS = [
  'ageGroup',
  'gender',
  'country',
  'deviceType',
  'operatingSystem',
  'city',
  'subscribedStatus',
];

const input = {
  videoId: 'vid',
  // The sync's window: the last data date minus three days.
  startDate: new Date('2026-10-16T00:00:00Z'),
  endDate: new Date('2026-10-20T00:00:00Z'),
  publishedAt: new Date('2026-08-03T14:00:00Z'),
};

function answer(refuse: (params: Params) => Error | null) {
  query.mockImplementation(async (params: Params) => {
    const refusal = refuse(params);
    if (refusal) throw refusal;
    return { data: { rows: [] } };
  });
}

const asked = () => query.mock.calls.map(([params]) => params as Params);

beforeEach(() => {
  query.mockReset();
  warn.mockReset();
});

describe('YouTube audience breakdowns cover the video’s lifetime (KB-212)', () => {
  it('asks every audience breakdown from the publish date to the end of the window', async () => {
    answer(() => null);

    await new YouTubeAnalyticsProvider('token').getVideoAnalytics(input);

    for (const dimension of AUDIENCE_DIMENSIONS) {
      const params = asked().find((p) => p.dimensions === dimension);
      expect(params, dimension).toMatchObject({
        startDate: '2026-08-03',
        endDate: '2026-10-20',
      });
    }
  });

  it('still asks the days over the sync window', async () => {
    answer(() => null);

    await new YouTubeAnalyticsProvider('token').getVideoAnalytics(input);

    const days = asked().find(
      (p) => p.dimensions === 'day' && p.metrics.includes('likes'),
    );
    expect(days).toMatchObject({
      startDate: '2026-10-16',
      endDate: '2026-10-20',
    });
  });
});

describe('YouTube optional queries say when they are refused (KB-212)', () => {
  it.each([
    ['retention', (p: Params) => p.metrics === 'audienceWatchRatio'],
    ['demographics', (p: Params) => p.dimensions === 'ageGroup'],
    ['device-type', (p: Params) => p.dimensions === 'deviceType'],
    ['operating-system', (p: Params) => p.dimensions === 'operatingSystem'],
    ['city', (p: Params) => p.dimensions === 'city'],
    ['subscribed-status', (p: Params) => p.dimensions === 'subscribedStatus'],
  ])('logs a refused %s query and keeps the rest', async (name, refused) => {
    answer((p) =>
      refused(p) ? new Error('The query is not supported.') : null,
    );

    const result = await new YouTubeAnalyticsProvider(
      'token',
    ).getVideoAnalytics(input);

    expect(result.dailyData).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'youtube-analytics.query-refused',
        error: expect.stringContaining('The query is not supported.'),
      }),
      `YouTube Analytics ${name} query failed; stored as not reported`,
    );
  });

  it('rethrows a missing scope on the retention query, rather than storing no curve', async () => {
    answer((p) =>
      p.metrics === 'audienceWatchRatio'
        ? new Error('Request had insufficient authentication scopes.')
        : null,
    );

    await expect(
      new YouTubeAnalyticsProvider('token').getVideoAnalytics(input),
    ).rejects.toBeInstanceOf(YouTubeAnalyticsScopeError);
  });

  it('rethrows a quota error on the device query', async () => {
    answer((p) =>
      p.dimensions === 'deviceType' ? new Error('Quota exceeded') : null,
    );

    await expect(
      new YouTubeAnalyticsProvider('token').getVideoAnalytics(input),
    ).rejects.toThrow(/Quota exceeded/);
  });
});
