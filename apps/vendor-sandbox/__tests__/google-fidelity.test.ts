import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { documentedNames } from '../../../packages/features/content-analytics/__tests__/helpers/capability-reference';
import type { Sandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';
import { nextDate, pacificDate, pacificMidnight } from '../src/social/pacific';
import {
  ANALYTICS_DIMENSIONS,
  ANALYTICS_METRICS,
} from '../src/social/vendors/google/analytics';
import { threeSignificantFigures } from '../src/social/vendors/google/data';
import { REPORT_TYPES } from '../src/social/vendors/google/reporting';
import {
  ALL_YOUTUBE_SCOPES,
  type GoogleTokens,
  connectYouTube,
  googleSandbox,
  refreshYouTube,
} from './google-helpers';

/**
 * FILM-1802 criteria 5, 6 and 7 for the Google origin: every response the
 * sandbox serves names only fields its registry entry declares (so only
 * fields the capability reference documents), and every YouTube behaviour in
 * §3's table is reproduced.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.parse('2026-09-20T17:00:00Z');
const index = documentedNames();

let now = T0;
let sandbox: Sandbox;
let tokens: GoogleTokens;
let videoFile: string;

function entry(method: string, path: string): ServedEndpoint {
  const found = SERVED.find(
    (e) => e.origin === 'google' && e.method === method && e.path === path,
  );
  if (!found) throw new Error(`no registry entry for ${method} ${path}`);
  return found;
}
const ERROR_ENTRY = () => entry('GET', '(any error)');

async function call(
  path: string,
  init: RequestInit = {},
  token = tokens.access_token,
) {
  const response = await fetch(`${sandbox.urls.google}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as unknown) : {},
  };
}

async function upload(title: string) {
  const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
  return new YouTubeProvider(tokens.access_token).uploadVideo({
    videoPath: videoFile,
    title,
    description: 'From the harbour series.',
    tags: ['drama'],
    categoryId: '1',
    privacy: 'public',
    madeForKids: false,
  });
}

const query = (params: Record<string, string>) =>
  `/v2/reports?${new URLSearchParams({ ids: 'channel==MINE', ...params })}`;

beforeAll(async () => {
  sandbox = await googleSandbox(18022, () => now);
  const dir = mkdtempSync(join(tmpdir(), 'ytf-'));
  videoFile = join(dir, 'episode.mp4');
  writeFileSync(videoFile, Buffer.alloc(32 * 1024, 5));
  tokens = await connectYouTube(sandbox);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('what the Google origin serves is what the reference documents', () => {
  it('the served metric, dimension and report names are all in the field index', () => {
    const metrics = index.get('youtube/analytics-metrics')!;
    const dimensions = index.get('youtube/analytics-dimensions')!;
    const reports = index.get('youtube/reporting')!;
    const columns = index.get('youtube/reporting-columns')!;

    expect(ANALYTICS_METRICS.filter((m) => !metrics.has(m))).toEqual([]);
    expect(
      Object.keys(ANALYTICS_DIMENSIONS).filter((d) => !dimensions.has(d)),
    ).toEqual([]);
    expect(Object.keys(REPORT_TYPES).filter((r) => !reports.has(r))).toEqual(
      [],
    );
    const served = Object.values(REPORT_TYPES).flatMap((t) => [
      ...t.dimensions,
      ...t.metrics,
    ]);
    expect(served.filter((c) => !columns.has(c))).toEqual([]);
  });

  it('token responses: the code exchange and the refresh', async () => {
    expect(undeclaredKeys(entry('POST', '/token'), tokens)).toEqual([]);
    expect(
      undeclaredKeys(
        entry('POST', '/token'),
        await refreshYouTube(tokens.refresh_token!),
      ),
    ).toEqual([]);
  });

  it('channels, videos, the upload, a thumbnail and a playlist item', async () => {
    const channels = await call(
      '/youtube/v3/channels?part=snippet,statistics&mine=true',
    );
    expect(
      undeclaredKeys(entry('GET', '/youtube/v3/channels'), channels.body),
    ).toEqual([]);

    const video = await upload('Salt on the Window');
    const listed = await call(
      `/youtube/v3/videos?part=snippet,contentDetails,status,statistics&id=${video.videoId}`,
    );
    expect(
      undeclaredKeys(entry('GET', '/youtube/v3/videos'), listed.body),
    ).toEqual([]);

    const inserted = sandbox.state.ledger
      .list({ vendor: 'google', object: video.videoId })
      .find((e) => e.path === '/upload/youtube/v3/videos')!;
    expect(inserted.status).toBe(200);
    expect(
      undeclaredKeys(
        entry('POST', '/upload/youtube/v3/videos'),
        JSON.parse(inserted.responseSummary!),
      ),
    ).toEqual([]);

    const thumb = await call(
      `/upload/youtube/v3/thumbnails/set?videoId=${video.videoId}&uploadType=media`,
      {
        method: 'POST',
        body: Buffer.alloc(1024, 1),
      },
    );
    expect(thumb.status).toBe(200);
    expect(
      undeclaredKeys(
        entry('POST', '/upload/youtube/v3/thumbnails/set'),
        thumb.body,
      ),
    ).toEqual([]);

    const item = await call('/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      body: JSON.stringify({
        snippet: {
          playlistId: 'PLharbour',
          resourceId: { kind: 'youtube#video', videoId: video.videoId },
        },
      }),
    });
    expect(item.status).toBe(200);
    expect(
      undeclaredKeys(entry('POST', '/youtube/v3/playlistItems'), item.body),
    ).toEqual([]);
  });

  it("analytics results and Reporting resources, including a report CSV's columns", async () => {
    now = T0 + 6 * DAY;
    tokens = {
      ...tokens,
      access_token: String(
        (await refreshYouTube(tokens.refresh_token!)).access_token,
      ),
    };
    const start = pacificDate(T0 - DAY);
    const end = pacificDate(now);

    for (const dimensions of [
      '',
      'day',
      'country',
      'ageGroup',
      'insightTrafficSourceType',
    ]) {
      const result = await call(
        query({
          startDate: start,
          endDate: end,
          metrics: 'views,estimatedMinutesWatched',
          ...(dimensions ? { dimensions } : {}),
        }),
      );
      expect(result.status, dimensions).toBe(200);
      expect(
        undeclaredKeys(entry('GET', '/v2/reports'), result.body),
        dimensions,
      ).toEqual([]);
    }

    const types = await call('/v1/reportTypes');
    expect(undeclaredKeys(entry('GET', '/v1/reportTypes'), types.body)).toEqual(
      [],
    );
    const created = await call('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ reportTypeId: 'channel_basic_a3', name: 'basic' }),
    });
    expect(undeclaredKeys(entry('POST', '/v1/jobs'), created.body)).toEqual([]);
    const jobs = await call('/v1/jobs');
    expect(undeclaredKeys(entry('GET', '/v1/jobs'), jobs.body)).toEqual([]);
    const jobId = (created.body as { id: string }).id;
    const reports = await call(`/v1/jobs/${jobId}/reports`);
    expect(
      undeclaredKeys(entry('GET', '/v1/jobs/{jobId}/reports'), reports.body),
    ).toEqual([]);

    const [first] = (
      reports.body as { reports: Array<{ downloadUrl: string }> }
    ).reports;
    const csv = await (
      await fetch(first!.downloadUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
    ).text();
    const header = csv.split('\n')[0]!.split(',');
    expect(
      undeclaredKeys(
        entry('GET', '/v1/media/{resourceName}'),
        Object.fromEntries(header.map((h) => [h, 1])),
      ),
    ).toEqual([]);
  });

  it('error bodies: 401, 403 and 400 all use the documented envelope', async () => {
    const unauthenticated = await call(
      '/youtube/v3/channels?part=snippet&mine=true',
      {},
      'sbx.youtube.not-a-token',
    );
    const forbidden = await call(
      query({
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        metrics: 'views',
        ids: 'channel==UCsomeoneElse000000000000',
      }),
    );
    const bad = await call(
      query({
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        metrics: 'plays',
      }),
    );
    for (const [status, response] of [
      [401, unauthenticated],
      [403, forbidden],
      [400, bad],
    ] as const) {
      expect(response.status).toBe(status);
      expect(undeclaredKeys(ERROR_ENTRY(), response.body)).toEqual([]);
    }
  });
});

describe('§3: YouTube behaviour the sandbox must reproduce', () => {
  it('analytics metrics are valid with dimensions=day and filters=video==ID', async () => {
    const video = sandbox.social.listObjects('youtube')[0]!;
    const result = await call(
      query({
        startDate: pacificDate(T0),
        endDate: pacificDate(now),
        metrics: 'views,averageViewPercentage',
        dimensions: 'day',
        filters: `video==${video.id}`,
      }),
    );
    expect(result.status).toBe(200);
    expect((result.body as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });

  it('a 48–72 hour processing delay: a video a day old has no rows yet; three days on, it has', async () => {
    const video = await upload('The Night Porter Keeps a Diary');
    const params = {
      startDate: pacificDate(now - DAY),
      endDate: pacificDate(now + 4 * DAY),
      metrics: 'views',
      dimensions: 'day',
      filters: `video==${video.videoId}`,
    };

    now += 24 * HOUR;
    tokens = {
      ...tokens,
      access_token: String(
        (await refreshYouTube(tokens.refresh_token!)).access_token,
      ),
    };
    const early = await call(query(params));
    expect(early.body).not.toHaveProperty('rows');

    now += 3 * DAY;
    tokens = {
      ...tokens,
      access_token: String(
        (await refreshYouTube(tokens.refresh_token!)).access_token,
      ),
    };
    const later = await call(query(params));
    expect((later.body as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });

  it('revenue metrics need yt-analytics-monetary.readonly', async () => {
    const withoutMonetary = await connectYouTube(
      sandbox,
      ALL_YOUTUBE_SCOPES.filter((s) => !s.includes('monetary')),
    );
    const params = {
      startDate: pacificDate(T0),
      endDate: pacificDate(now),
      metrics: 'estimatedRevenue',
    };
    expect(
      (await call(query(params), {}, withoutMonetary.access_token)).status,
    ).toBe(403);
    expect((await call(query(params))).status).toBe(200);
  });

  it('a Reporting job backfills 30 days from its creation, no further', async () => {
    const created = await call('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ reportTypeId: 'channel_reach_basic_a1' }),
    });
    const jobId = (created.body as { id: string }).id;
    const { reports } = (await call(`/v1/jobs/${jobId}/reports`)).body as {
      reports: Array<{ startTime: string }>;
    };
    const oldest = reports
      .map((r) => Date.parse(r.startTime))
      .sort((a, b) => a - b)[0]!;
    expect(new Date(oldest).toISOString()).toBe(
      new Date(pacificMidnight(pacificDate(now - 30 * DAY))).toISOString(),
    );
  });

  it('creatorContentType tells a Short from a long-form video', async () => {
    const short = await upload('One Minute at the Harbour #Shorts');
    now += 4 * DAY;
    tokens = {
      ...tokens,
      access_token: String(
        (await refreshYouTube(tokens.refresh_token!)).access_token,
      ),
    };
    const result = await call(
      query({
        startDate: pacificDate(now - 6 * DAY),
        endDate: pacificDate(now),
        metrics: 'views',
        dimensions: 'creatorContentType',
        filters: `video==${short.videoId}`,
      }),
    );
    expect(
      (result.body as { rows: Array<[string, number]> }).rows.map((r) => r[0]),
    ).toEqual(['SHORTS']);
  });

  it('the documented refusals: retention needs one video, averageViewPercentage refuses liveOrOnDemand', async () => {
    const window = { startDate: pacificDate(T0), endDate: pacificDate(now) };
    expect(
      (
        await call(
          query({
            ...window,
            metrics: 'audienceWatchRatio',
            dimensions: 'elapsedVideoTimeRatio',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          query({
            ...window,
            metrics: 'averageViewPercentage',
            dimensions: 'liveOrOnDemand',
          }),
        )
      ).status,
    ).toBe(400);
  });

  it('no data is no rows at all, not zeros', async () => {
    const result = await call(
      query({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        metrics: 'views',
        dimensions: 'day',
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty('rows');
  });

  it('subscriberCount is rounded down to three significant figures', () => {
    expect(threeSignificantFigures(987)).toBe(987);
    expect(threeSignificantFigures(12_345)).toBe(12_300);
    expect(threeSignificantFigures(1_987_654)).toBe(1_980_000);
  });

  it("a breakdown's parts add up to the whole", async () => {
    const params = {
      startDate: pacificDate(T0),
      endDate: pacificDate(now),
      metrics: 'views',
    };
    const total = ((await call(query(params))).body as { rows: number[][] })
      .rows[0]![0]!;
    for (const dimensions of ['country', 'deviceType', 'subscribedStatus']) {
      const rows = (
        (await call(query({ ...params, dimensions }))).body as {
          rows: Array<[string, number]>;
        }
      ).rows;
      expect(
        rows.reduce((sum, [, views]) => sum + views, 0),
        dimensions,
      ).toBe(total);
    }
  });

  it("the client is checked: another app's client id gets invalid_client", async () => {
    const { YOUTUBE_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/youtube'
    );
    const refused = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token!,
        client_id: 'someone-elses-app.apps.googleusercontent.com',
        client_secret: SANDBOX_CLIENTS.youtube.clientSecret,
      }),
    });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('a day on a report is a Pacific day', () => {
    // 2026-09-25 07:30 UTC is 00:30 in Los Angeles (PDT, UTC-7).
    expect(pacificDate(Date.parse('2026-09-25T07:30:00Z'))).toBe('2026-09-25');
    expect(pacificDate(Date.parse('2026-09-25T06:30:00Z'))).toBe('2026-09-24');
    // Winter: PST, UTC-8. And the day DST ends is 25 hours long.
    expect(new Date(pacificMidnight('2026-12-01')).toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
    expect(
      pacificMidnight(nextDate('2026-11-01')) - pacificMidnight('2026-11-01'),
    ).toBe(25 * HOUR);
  });
});
