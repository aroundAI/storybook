import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseChannelBasicReport } from '../../../packages/features/content-analytics/src/server/reporting/csv-parsers';
import { SANDBOX_CLIENTS } from '../src/social/credentials';
import { nextDate, pacificDate, pacificMidnight } from '../src/social/pacific';
import type { Sandbox } from '../src/sandbox';
import {
  ALL_YOUTUBE_SCOPES,
  APP,
  type GoogleTokens,
  connectYouTube,
  googleSandbox,
  refreshYouTube,
} from './google-helpers';

/**
 * FILM-1802 PR B: the app's own YouTube code, unchanged, against the
 * sandbox — the OAuth config the connect and callback routes use, the
 * publishing provider, the analytics provider and the Reporting provider and
 * its CSV parser. Not a hand-written client: if the app's calls and the
 * sandbox disagree about the vendor, this is where it shows.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-20T10:00:00Z');
let now = T0;
let sandbox: Sandbox;
let videoFile: string;

beforeAll(async () => {
  sandbox = await googleSandbox(18021, () => now);
  const dir = mkdtempSync(join(tmpdir(), 'yt-'));
  videoFile = join(dir, 'episode.mp4');
  writeFileSync(videoFile, Buffer.alloc(64 * 1024, 7));
  writeFileSync(join(dir, 'thumb.jpg'), Buffer.alloc(2048, 3));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('YouTube, end to end through the app’s own clients', () => {
  let tokens: GoogleTokens;
  let channelId: string;
  let videoId: string;

  it('connects: consent, code exchange, and the channel the callback reads', async () => {
    tokens = await connectYouTube(sandbox);
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope.split(' ').sort()).toEqual([...ALL_YOUTUBE_SCOPES].sort());

    const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
    const channel = await new YouTubeProvider(tokens.access_token).getChannel();
    channelId = channel.id;
    expect(channel.id).toMatch(/^UC[A-Za-z0-9]{22}$/);
    expect(channel.title.length).toBeGreaterThan(3);
    expect(channel.thumbnailUrl).toContain(sandbox.urls.google);

    const count = await new YouTubeProvider(tokens.access_token).getSubscriberCount(channel.id);
    expect(count.ok).toBe(true);
  });

  it('a code works once', async () => {
    const { YOUTUBE_OAUTH_CONFIG } = await import('@kit/publishing/oauth/youtube');
    const again = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        code: 'sbx-code-never-issued',
        client_id: SANDBOX_CLIENTS.youtube.clientId,
        client_secret: SANDBOX_CLIENTS.youtube.clientSecret,
        redirect_uri: `${APP}/api/platforms/callback/youtube`,
        grant_type: 'authorization_code',
      }),
    });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('publishes through the provider: the upload creates the video, the thumbnail lands on it', async () => {
    const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
    const result = await new YouTubeProvider(tokens.access_token).uploadVideo({
      videoPath: videoFile,
      title: 'The Lighthouse Keeper’s Last Night',
      description: 'Part two of the lighthouse story.',
      tags: ['short film', 'drama'],
      categoryId: '1',
      privacy: 'public',
      madeForKids: false,
      thumbnailPath: videoFile.replace('episode.mp4', 'thumb.jpg'),
    });
    videoId = result.videoId;
    expect(result.videoId).toMatch(/^[A-Za-z0-9]{11}$/);
    expect(result.thumbnailUrl).toContain(sandbox.urls.google);

    const object = sandbox.social.object('youtube', videoId);
    expect(object.adopted).toBe(false);
    expect(object.accountId).toBe(channelId);
    expect(object.title).toBe('The Lighthouse Keeper’s Last Night');
  });

  it('an access token expires in real time, as the refresh cron expects', async () => {
    now = T0 + 5 * DAY;
    const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
    await expect(new YouTubeProvider(tokens.access_token).getChannel()).rejects.toThrow(
      /invalid authentication credentials/,
    );
    tokens = {
      ...tokens,
      access_token: String((await refreshYouTube(tokens.refresh_token!)).access_token),
    };
  });

  it('the next sync reports on it: totals equal the day rows, and the ledger saw every call', async () => {
    const { createYouTubeAnalyticsProvider } = await import('@kit/content-analytics/providers/youtube');
    const analytics = createYouTubeAnalyticsProvider(tokens.access_token);
    const result = await analytics.getVideoAnalytics({
      videoId,
      startDate: new Date(T0 - DAY),
      endDate: new Date(now),
      includeRevenue: true,
    });

    expect(result.totals.views).toBeGreaterThan(0);
    const daily = result.dailyData.reduce((sum, d) => sum + d.views, 0);
    expect(daily).toBe(result.totals.views);
    expect(result.revenueAccess).toBe('authorised');
    // 48–72 hours of processing: the last two days have no row yet.
    const lastDay = result.dailyData.at(-1)!.date;
    expect(Date.parse(lastDay)).toBeLessThanOrEqual(now - 2 * DAY);
    expect(result.retention?.points ?? []).toHaveLength(100);

    const video = await analytics.getVideoInfo(videoId);
    expect(video.title).toBe('The Lighthouse Keeper’s Last Night');

    const ledger = sandbox.state.ledger.list({ vendor: 'google', object: videoId });
    expect(ledger.map((e) => e.path)).toEqual(
      expect.arrayContaining(['/upload/youtube/v3/videos', '/v2/reports', '/youtube/v3/videos']),
    );
  });

  it('Reporting: a job, its backfilled daily reports, and CSVs the app’s parser sums back to the day’s figures', async () => {
    const { createYouTubeReportingProvider } = await import('@kit/content-analytics/providers/youtube');
    const reporting = createYouTubeReportingProvider(tokens.access_token);

    expect(await reporting.listJobs()).toEqual([]);
    const job = await reporting.createJob('channel_basic_a3');
    expect(await reporting.listJobs()).toEqual([job]);

    const reports = await reporting.listReports(job.jobId);
    // A new job backfills 30 days before its creation, one report per Pacific
    // day, each available only after its 48–72 hour processing delay.
    const oldest = reports[0]!;
    expect(oldest.startTime).toBe(
      new Date(pacificMidnight(pacificDate(now - 30 * DAY))).toISOString(),
    );
    for (const r of reports) {
      expect(Date.parse(r.createTime)).toBeLessThanOrEqual(now);
      expect(Date.parse(r.createTime) - Date.parse(r.endTime)).toBeGreaterThanOrEqual(48 * 3_600_000);
    }
    expect(reports.length).toBeGreaterThanOrEqual(27);
    expect(reports.length).toBeLessThanOrEqual(28);

    // YouTube's days are Pacific days: the day after publishing, as YouTube cuts it.
    const object = sandbox.social.object('youtube', videoId);
    const dayAfter = nextDate(pacificDate(object.publishedMs));
    const report = reports.find(
      (r) => r.startTime === new Date(pacificMidnight(dayAfter)).toISOString(),
    )!;
    const csv = await reporting.downloadReport(report.downloadUrl);
    const rows = parseChannelBasicReport(csv);

    const expected =
      sandbox.social.cumulative(object, 'views', pacificMidnight(nextDate(dayAfter))) -
      sandbox.social.cumulative(object, 'views', pacificMidnight(dayAfter));
    expect(rows[0]?.date).toBe(dayAfter);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.youtubeVideoId).toBe(videoId);
    expect(rows[0]!.views).toBe(expected);
  });

  it('a connection without the analytics scope fails analytics the way production does', async () => {
    const narrow = await connectYouTube(sandbox, ALL_YOUTUBE_SCOPES.slice(0, 3));
    const { createYouTubeAnalyticsProvider, YouTubeAnalyticsScopeError } = await import(
      '@kit/content-analytics/providers/youtube'
    );
    await expect(
      createYouTubeAnalyticsProvider(narrow.access_token).getVideoAnalytics({
        videoId,
        startDate: new Date(T0),
        endDate: new Date(now),
      }),
    ).rejects.toBeInstanceOf(YouTubeAnalyticsScopeError);
  });

  it('refresh gives a new access token and no new refresh token; revoke ends the grant', async () => {
    const { YOUTUBE_OAUTH_CONFIG } = await import('@kit/publishing/oauth/youtube');
    const refreshed = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: SANDBOX_CLIENTS.youtube.clientId,
        client_secret: SANDBOX_CLIENTS.youtube.clientSecret,
        refresh_token: tokens.refresh_token!,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await refreshed.json()) as Record<string, unknown>;
    expect(body.access_token).toBeTruthy();
    expect(body.access_token).not.toBe(tokens.access_token);
    expect(body.refresh_token).toBeUndefined();

    const revoked = await fetch(
      `${YOUTUBE_OAUTH_CONFIG.revokeUrl}?token=${encodeURIComponent(String(body.access_token))}`,
      { method: 'POST' },
    );
    expect(revoked.status).toBe(200);

    const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
    await expect(new YouTubeProvider(tokens.access_token).getChannel()).rejects.toThrow();
  });
});
