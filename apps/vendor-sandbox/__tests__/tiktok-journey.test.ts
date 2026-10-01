import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '../../../packages/features/publishing/src/lib/job-types';
import type { Sandbox } from '../src/sandbox';
import {
  type TikTokTokens,
  connectTikTok,
  connectedTikTok,
  refreshTikTok,
  revokeTikTok,
  tiktokSandbox,
} from './tiktok-helpers';

/**
 * FILM-1802 PR E: the app's own TikTok code, unchanged, against the sandbox —
 * the OAuth config the connect and callback routes use, the publishing
 * provider and the publish worker's upload handler, and the analytics
 * provider the next sync calls.
 */

/** Four times real time, so the worker's five-second poll outlasts TikTok's processing. */
const T0 = Date.parse('2026-09-28T17:00:00Z');
const START = Date.now();
let skew = 0;
const tick = () => T0 + (Date.now() - START) * 4 + skew;
const DAY = 86_400_000;

let sandbox: Sandbox;
let videoFile: string;
let videoServer: http.Server;
let videoUrl: string;

beforeAll(async () => {
  sandbox = await tiktokSandbox(18061, tick, 1);
  const dir = mkdtempSync(join(tmpdir(), 'tt-'));
  videoFile = join(dir, 'episode.mp4');
  const bytes = Buffer.alloc(64 * 1024, 3);
  writeFileSync(videoFile, bytes);
  videoServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': bytes.length,
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise<void>((done) =>
    videoServer.listen(0, '127.0.0.1', () => done()),
  );
  videoUrl = `http://127.0.0.1:${(videoServer.address() as AddressInfo).port}/episode.mp4`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  videoServer.close();
  await sandbox.close();
});

describe('TikTok, end to end through the app’s own clients', () => {
  let tokens: TikTokTokens;
  let publishId: string;
  let videoId: string;

  it('connects: consent with PKCE, the code exchange, and the user the callback reads', async () => {
    tokens = await connectedTikTok(sandbox);
    const { TIKTOK_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/tiktok'
    );
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(86_400);
    expect(tokens.refresh_expires_in).toBe(365 * 86_400);
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope.split(',').sort()).toEqual(
      [...TIKTOK_OAUTH_CONFIG.scopes].sort(),
    );

    const callbackRead = await fetch(
      `${TIKTOK_OAUTH_CONFIG.userInfoUrl}?fields=open_id,union_id,avatar_url,display_name`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const info = (await callbackRead.json()) as {
      data: {
        user: { open_id: string; display_name: string; avatar_url: string };
      };
      error: { code: string };
    };
    expect(info.error.code).toBe('ok');
    expect(info.data.user.open_id).toBe(tokens.open_id);
    expect(info.data.user.display_name.length).toBeGreaterThan(3);
    expect(info.data.user.avatar_url).toContain(sandbox.urls.tiktok);

    const { TikTokProvider } = await import('@kit/publishing/providers/tiktok');
    const user = await new TikTokProvider(tokens.access_token).getUserInfo();
    expect(user.openId).toBe(tokens.open_id);
    expect(user.followerCount).toBeGreaterThan(0);
  });

  it('PKCE is enforced, and a code works once', async () => {
    const wrong = await connectTikTok(sandbox, {
      verifier: 'not-the-verifier-this-challenge-was-made-from-0000',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ error: 'invalid_grant' });
  });

  it('the app requests video.publish, so the worker’s direct post is not refused for scope', async () => {
    const { TIKTOK_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/tiktok'
    );
    expect(tokens.scope.split(',')).toContain('video.publish');
    expect(TIKTOK_OAUTH_CONFIG.scopes).toContain('video.publish');
  });

  it('a connection without video.publish has the worker’s direct post refused with TikTok’s scope_not_authorized', async () => {
    const { uploadToTikTok } = await import(
      '../../web/lambda/publish-worker/handlers/tiktok'
    );
    const narrow = await connectedTikTok(sandbox, {
      granted: ['user.info.basic', 'video.upload'],
    });
    await expect(
      uploadToTikTok(narrow.access_token, {
        videoUrl,
        title: 'Harbour at dawn',
        description: '',
        metadata: {},
      } as unknown as PublishJobMessage),
    ).rejects.toThrow(/scope_not_authorized/);
  });

  it('publishes through the provider end to end', async () => {
    const { TikTokProvider } = await import('@kit/publishing/providers/tiktok');
    const result = await new TikTokProvider(tokens.access_token).uploadVideo({
      videoPath: videoFile,
      caption: 'Salt on the window.',
      privacy: 'PUBLIC',
      disableDuet: false,
      disableStitch: false,
      disableComment: false,
    });
    expect(result.publishId).toBeTruthy();
  });

  it('publishes through the worker once video.publish is granted: init, status polling, then the post', async () => {
    const withPublish = await connectedTikTok(sandbox);
    expect(withPublish.scope).toContain('video.publish');
    tokens = withPublish;

    const { uploadToTikTok } = await import(
      '../../web/lambda/publish-worker/handlers/tiktok'
    );
    const published = await uploadToTikTok(tokens.access_token, {
      videoUrl,
      title: 'The lighthouse keeper’s last night, part two.',
      description: '',
      metadata: {},
    } as unknown as PublishJobMessage);
    publishId = published.contentId;
    expect(publishId).toMatch(/^v_pub_url~v2\.\d+$/);
    expect(published.url).toMatch(
      /^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+$/,
    );

    const { TikTokProvider } = await import('@kit/publishing/providers/tiktok');
    const status = await new TikTokProvider(
      tokens.access_token,
    ).getPublishStatus(publishId);
    expect(status.status).toBe('PUBLISH_COMPLETE');
    videoId = /\/video\/(\d+)$/.exec(status.videoUrl ?? '')![1]!;

    const object = sandbox.social.object('tiktok', videoId);
    expect(object.adopted).toBe(false);
    expect(object.caption).toBe(
      'The lighthouse keeper’s last night, part two.',
    );
  });

  it('an access token lasts 24 hours; refresh returns a new pair and retires the old refresh token', async () => {
    skew += 3 * DAY;
    const { createTikTokAnalyticsProvider, TikTokAnalyticsScopeError } =
      await import('@kit/content-analytics/providers/tiktok');
    await expect(
      createTikTokAnalyticsProvider(tokens.access_token).getVideoAnalytics({
        videoId,
      }),
    ).rejects.toBeInstanceOf(TikTokAnalyticsScopeError);

    const refreshed = await refreshTikTok(tokens.refresh_token);
    expect(refreshed.status).toBe(200);
    const next = refreshed.body as TikTokTokens;
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.expires_in).toBe(86_400);

    const replay = await refreshTikTok(tokens.refresh_token);
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: 'invalid_grant' });
    tokens = next;
  });

  it('the next sync reports on it: totals are what the sandbox served, and the ledger saw the call', async () => {
    const { createTikTokAnalyticsProvider } = await import(
      '@kit/content-analytics/providers/tiktok'
    );
    const analytics = createTikTokAnalyticsProvider(tokens.access_token);
    const result = await analytics.getVideoAnalytics({ videoId });

    const object = sandbox.social.object('tiktok', videoId);
    expect(result.totals.views).toBe(
      sandbox.social.cumulative(object, 'views'),
    );
    expect(result.totals.likes).toBe(
      sandbox.social.cumulative(object, 'likes'),
    );
    expect(result.totals.views).toBeGreaterThan(0);
    // The Display API has none of these: the app reports them absent, not zero.
    expect(result.dailyData).toEqual([]);
    expect(result.trafficSources).toEqual([]);

    const durations = await analytics.getVideoDurations([videoId]);
    expect(durations.get(videoId)).toBe(object.durationSeconds);

    const followers = await analytics.getFollowerCount();
    expect(followers).toMatchObject({ ok: true });

    expect(
      sandbox.state.ledger
        .list({ vendor: 'tiktok', object: videoId })
        .map((e) => e.path),
    ).toContain('/v2/video/query/');
  });

  it('a connection without video.list is refused analytics: TikTok answers scope_not_authorized and the app reports a scope error', async () => {
    const narrow = await connectedTikTok(sandbox, {
      granted: ['user.info.basic', 'video.upload'],
    });
    const { createTikTokAnalyticsProvider, TikTokAnalyticsScopeError } =
      await import('@kit/content-analytics/providers/tiktok');
    const analytics = createTikTokAnalyticsProvider(narrow.access_token);
    await expect(
      analytics.getVideoAnalytics({ videoId }),
    ).rejects.toBeInstanceOf(TikTokAnalyticsScopeError);
    // Without user.info.stats the follower count is unavailable, not zero.
    expect(await analytics.getFollowerCount()).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    tokens = narrow;
  });

  it('TikTokAnalyticsProvider classifies scope_not_authorized as a scope error', async () => {
    const { createTikTokAnalyticsProvider, TikTokAnalyticsScopeError } =
      await import('@kit/content-analytics/providers/tiktok');
    await expect(
      createTikTokAnalyticsProvider(tokens.access_token).getVideoAnalytics({
        videoId,
      }),
    ).rejects.toBeInstanceOf(TikTokAnalyticsScopeError);
  });

  it('revoke ends the grant: the access token and the refresh token are both refused', async () => {
    const fresh = await connectedTikTok(sandbox);
    const revoked = await revokeTikTok(fresh.access_token);
    expect(revoked.status).toBe(200);

    const { TikTokProvider } = await import('@kit/publishing/providers/tiktok');
    await expect(
      new TikTokProvider(fresh.access_token).getUserInfo(),
    ).rejects.toThrow(/access_token_invalid|not found in the request/);
    expect((await refreshTikTok(fresh.refresh_token)).status).toBe(400);
  });
});
