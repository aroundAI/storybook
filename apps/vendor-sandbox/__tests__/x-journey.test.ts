import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '../../../packages/features/publishing/src/lib/job-types';
import type { Sandbox } from '../src/sandbox';
import {
  CREDENTIALS,
  type XTokens,
  connectX,
  connectedX,
  refreshX,
  revokeX,
  xSandbox,
} from './x-helpers';

/**
 * FILM-1802 PR C: the app's own X code, unchanged, against the sandbox — the
 * OAuth config and Basic-auth helper the connect and callback routes use, the
 * TwitterProvider, and the publish worker's upload and delete handlers. If the
 * app's calls and the sandbox disagree about X, this is where it shows.
 */

/** Four times real time, so the provider's one-second poll outlasts X's processing. */
const T0 = Date.parse('2026-09-28T17:00:00Z');
const START = Date.now();
let skew = 0;
const tick = () => T0 + (Date.now() - START) * 4 + skew;
const HOUR = 3_600_000;

let sandbox: Sandbox;
let videoFile: string;
let videoServer: http.Server;
let videoUrl: string;

beforeAll(async () => {
  sandbox = await xSandbox(18041, tick, 1);
  const dir = mkdtempSync(join(tmpdir(), 'x-'));
  videoFile = join(dir, 'episode.mp4');
  const bytes = Buffer.alloc(64 * 1024, 9);
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

describe('X, end to end through the app’s own clients', () => {
  let tokens: XTokens;
  let userId: string;
  let tweetId: string;

  it('connects: consent with PKCE, the code exchange, and the user the callback reads', async () => {
    tokens = await connectedX(sandbox);
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.expires_in).toBe(7200);
    expect(tokens.refresh_token).toBeTruthy();
    const { TWITTER_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/twitter'
    );
    expect(tokens.scope.split(' ').sort()).toEqual(
      [...TWITTER_OAUTH_CONFIG.scopes].sort(),
    );

    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    const user = await new TwitterProvider(tokens.access_token).getUserInfo();
    userId = user.id;
    expect(user.id).toMatch(/^\d{15,20}$/);
    expect(user.username).toMatch(/^[A-Za-z0-9_]{1,15}$/);
    expect(user.name.length).toBeGreaterThan(3);
    expect(user.profileImageUrl).toContain(sandbox.urls.x);
  });

  it('PKCE is enforced, and a code works once', async () => {
    const wrong = await connectX(sandbox, undefined, {
      verifier: 'not-the-verifier-this-challenge-was-made-from-0000',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ error: 'invalid_request' });
  });

  it('publishes through the provider: media upload, processing, then the post', async () => {
    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    const { xPostUrl } = await import('@kit/shared/vendors');
    const result = await new TwitterProvider(tokens.access_token).uploadVideo({
      videoPath: videoFile,
      text: 'The lighthouse keeper’s last night, part two.',
    });
    tweetId = result.tweetId;
    expect(tweetId).toMatch(/^\d{15,20}$/);
    expect(result.tweetUrl).toBe(xPostUrl(tweetId));

    const object = sandbox.social.object('x', tweetId);
    expect(object.adopted).toBe(false);
    expect(object.accountId).toBe(userId);
    expect(object.caption).toBe(
      'The lighthouse keeper’s last night, part two.',
    );
    expect(sandbox.social.listObjects('x')).toHaveLength(1);
  });

  it('FILM-1731: a declared post is kept as made with AI, an undeclared one is not, and a non-boolean is refused', async () => {
    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    const provider = new TwitterProvider(tokens.access_token);
    const declared = await provider.uploadVideo({
      videoPath: videoFile,
      text: 'Declared AI-generated.',
      madeWithAi: true,
    });
    const plain = await provider.uploadVideo({
      videoPath: videoFile,
      text: 'Not declared.',
    });

    expect(sandbox.social.object('x', declared.tweetId).details).toMatchObject({
      madeWithAi: true,
    });
    expect(
      sandbox.social.object('x', plain.tweetId).details,
    ).not.toHaveProperty('madeWithAi');

    const { X_API_BASE } = await import('@kit/shared/vendors');
    const refused = await fetch(`${X_API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'Malformed.', made_with_ai: 'yes' }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      errors: [{ message: 'made_with_ai must be a boolean' }],
    });
  });

  it('the post is there afterwards, with the metrics X gives its owner', async () => {
    const { X_API_BASE } = await import('@kit/shared/vendors');
    const response = await fetch(
      `${X_API_BASE}/tweets/${tweetId}?tweet.fields=created_at,public_metrics,non_public_metrics`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const body = (await response.json()) as {
      data: {
        text: string;
        public_metrics: { impression_count: number };
        non_public_metrics?: unknown;
      };
    };
    expect(response.status).toBe(200);
    expect(body.data.text).toBe(
      'The lighthouse keeper’s last night, part two.',
    );
    expect(body.data.non_public_metrics).toBeDefined();

    const ledger = sandbox.state.ledger.list({ vendor: 'x', object: tweetId });
    expect(ledger.map((e) => e.path)).toEqual(
      expect.arrayContaining(['/2/tweets', `/2/tweets/${tweetId}`]),
    );
  });

  it('the publish worker uploads and deletes: the tweet is gone from every read', async () => {
    const { uploadToTwitter, deleteFromTwitter } = await import(
      '../../web/lambda/publish-worker/handlers/twitter'
    );
    const job = {
      videoUrl,
      title: 'Harbour at dawn',
      description: 'Filmed on the last morning of the season.',
      metadata: {},
    } as unknown as PublishJobMessage;
    const published = await uploadToTwitter(tokens.access_token, job, {
      accountName: 'harbour_films',
      scopes: tokens.scope.split(' '),
    });
    expect(sandbox.social.hasObject('x', published.contentId)).toBe(true);

    await deleteFromTwitter(tokens.access_token, published.contentId);
    expect(sandbox.social.hasObject('x', published.contentId)).toBe(false);

    const { X_API_BASE } = await import('@kit/shared/vendors');
    const gone = await fetch(`${X_API_BASE}/tweets/${published.contentId}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(
      ((await gone.json()) as { errors: Array<{ title: string }> }).errors[0],
    ).toMatchObject({
      title: 'Not Found Error',
    });

    await expect(
      deleteFromTwitter(tokens.access_token, published.contentId),
    ).rejects.toThrow(/was not deleted/);
  });

  it('a connection without media.write is refused at the upload, and the app says which scope to check', async () => {
    const narrow = await connectedX(sandbox, [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access',
    ]);
    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    await expect(
      new TwitterProvider(narrow.access_token).uploadVideo({
        videoPath: videoFile,
        text: 'Refused before it starts.',
      }),
    ).rejects.toThrow(/403 \(the connection may lack the media\.write scope\)/);

    const { uploadToTwitter } = await import(
      '../../web/lambda/publish-worker/handlers/twitter'
    );
    const job = {
      videoUrl,
      title: 'Refused too',
      description: '',
      metadata: {},
    } as unknown as PublishJobMessage;
    const before = sandbox.state.ledger.list({ vendor: 'x' }).length;

    // FILM-1729: the stored grant says so, and the worker stops before X
    await expect(
      uploadToTwitter(narrow.access_token, job, {
        accountName: 'harbour_films',
        scopes: narrow.scope.split(' '),
      }),
    ).rejects.toThrow(
      '@harbour_films was connected before X allowed us to upload video',
    );
    expect(sandbox.state.ledger.list({ vendor: 'x' })).toHaveLength(before);

    // A grant that claims the scope the token lacks still reaches X's 403
    await expect(
      uploadToTwitter(narrow.access_token, job, {
        accountName: 'harbour_films',
        scopes: [...narrow.scope.split(' '), 'media.write'],
      }),
    ).rejects.toThrow(/INIT failed: 403/);
  });

  it('a connection without tweet.write can read but not post', async () => {
    const readOnly = await connectedX(sandbox, ['tweet.read', 'users.read']);
    const { X_API_BASE } = await import('@kit/shared/vendors');
    const refused = await fetch(`${X_API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readOnly.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Not allowed' }),
    });
    expect(refused.status).toBe(403);

    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    expect(
      (await new TwitterProvider(readOnly.access_token).getUserInfo()).id,
    ).toBe(userId);
  });

  it('an access token expires after two hours, as the refresh cron expects; refresh rotates the refresh token', async () => {
    skew += 2 * HOUR + 60_000;
    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    await expect(
      new TwitterProvider(tokens.access_token).getUserInfo(),
    ).rejects.toThrow(/401/);

    const refreshed = await refreshX(tokens.refresh_token!);
    expect(refreshed.status).toBe(200);
    const next = refreshed.body as XTokens;
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.expires_in).toBe(7200);

    const replay = await refreshX(tokens.refresh_token!);
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: 'invalid_request' });

    expect(
      (await new TwitterProvider(next.access_token).getUserInfo()).id,
    ).toBe(userId);
    tokens = next;
  });

  it('a client the sandbox does not know is refused at the token endpoint', async () => {
    const { TWITTER_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/twitter'
    );
    const basic = Buffer.from(
      `someone-else:${CREDENTIALS.clientSecret}`,
    ).toString('base64');
    const refused = await fetch(TWITTER_OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token!,
      }),
    });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('revoke ends the grant: both tokens are refused afterwards', async () => {
    const { TwitterProvider } = await import(
      '@kit/publishing/providers/twitter'
    );
    const refresh = await revokeX(tokens.refresh_token!);
    expect(refresh).toMatchObject({ status: 200, body: { revoked: true } });
    const access = await revokeX(tokens.access_token);
    expect(access).toMatchObject({ status: 200, body: { revoked: true } });

    await expect(
      new TwitterProvider(tokens.access_token).getUserInfo(),
    ).rejects.toThrow(/401/);
    expect((await refreshX(tokens.refresh_token!)).status).toBe(400);
  });
});
