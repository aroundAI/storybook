import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '../../../packages/features/publishing/src/lib/job-types';
import type { Sandbox } from '../src/sandbox';
import {
  type LinkedInTokens,
  connectedLinkedIn,
  linkedInSandbox,
  refreshLinkedIn,
} from './linkedin-helpers';

/**
 * FILM-1802 PR D: the app's own LinkedIn code, unchanged, against the
 * sandbox — the OAuth config the connect and callback routes use, the
 * LinkedInProvider, and the publish worker's upload handler.
 */

/** Four times real time, so the provider's five-second poll outlasts LinkedIn's processing. */
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
  sandbox = await linkedInSandbox(18051, tick, 1);
  const dir = mkdtempSync(join(tmpdir(), 'li-'));
  videoFile = join(dir, 'episode.mp4');
  const bytes = Buffer.alloc(96 * 1024, 5);
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

describe('LinkedIn, end to end through the app’s own clients', () => {
  let tokens: LinkedInTokens;
  let authorUrn: string;
  let textPostUrn: string;

  it('connects: consent, the code exchange, and the profile the callback reads', async () => {
    tokens = await connectedLinkedIn(sandbox);
    expect(tokens.expires_in).toBe(60 * 24 * 60 * 60);
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope.split(' ').sort()).toEqual(
      ['email', 'openid', 'profile', 'w_member_social'].sort(),
    );

    const { LINKEDIN_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/linkedin'
    );
    const profile = (await (
      await fetch(LINKEDIN_OAUTH_CONFIG.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
    ).json()) as { sub: string; name: string; picture: string; email: string };
    expect(profile.sub).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(profile.name).toMatch(/^\S+ \S+/);
    expect(profile.picture).toContain(sandbox.urls.linkedin);
    expect(profile.email).toMatch(/^[a-z.]+@[a-z.]+$/);
    authorUrn = `urn:li:person:${profile.sub}`;

    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    const user = await new LinkedInProvider(tokens.access_token).getUserInfo();
    expect(user.sub).toBe(profile.sub);
    expect(user.givenName).toBe(profile.name.split(' ')[0]);
  });

  it('a code works once, and a wrong code is the vendor’s own error', async () => {
    const { LINKEDIN_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/linkedin'
    );
    const refused = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'sbx-code-never-issued',
        client_id: 'sandboxlinkedinclient',
        client_secret: 'sandbox-linkedin-client-secret-not-a-real-secret',
        redirect_uri: 'http://localhost:3132/api/platforms/callback/linkedin',
      }),
    });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('publishes a text post through the provider: 201, the URN in x-restli-id', async () => {
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    const result = await new LinkedInProvider(
      tokens.access_token,
    ).createTextPost({
      text: 'Part two of the lighthouse story is live.',
      visibility: 'PUBLIC',
      authorUrn,
    });
    textPostUrn = result.postUrn;
    expect(textPostUrn).toMatch(/^urn:li:share:\d{19}$/);
    expect(result.postUrl).toBe(
      `https://www.linkedin.com/feed/update/${textPostUrn}`,
    );

    const object = sandbox.social.object('linkedin', textPostUrn);
    expect(object.adopted).toBe(false);
    expect(object.caption).toBe('Part two of the lighthouse story is live.');
    expect(
      sandbox.state.ledger.list({ vendor: 'linkedin', object: textPostUrn }),
    ).not.toHaveLength(0);
  });

  it('publishes a video through the worker: register, upload, then the share', async () => {
    const { uploadToLinkedIn } = await import(
      '../../web/lambda/publish-worker/handlers/linkedin'
    );
    const published = await uploadToLinkedIn(tokens.access_token, {
      videoUrl,
      title: 'Harbour at dawn',
      description: 'Filmed on the last morning of the season.',
      metadata: { authorUrn },
    } as unknown as PublishJobMessage);
    expect(published.contentId).toMatch(/^urn:li:share:\d{19}$/);

    const object = sandbox.social.object('linkedin', published.contentId);
    expect(object.details?.videoUrn).toMatch(/^urn:li:digitalmediaAsset:/);
    expect(object.accountId).toBe(authorUrn.replace('urn:li:person:', ''));
  });

  it('the provider’s video steps work, and the status call reports PROCESSING then AVAILABLE', async () => {
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    const provider = new LinkedInProvider(tokens.access_token);
    const init = await fetch(
      `${sandbox.urls.linkedin}/v2/videos?action=initializeUpload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: authorUrn,
            fileSizeBytes: 4,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      },
    );
    const { value } = (await init.json()) as {
      value: {
        video: string;
        uploadInstructions: Array<{ uploadUrl: string }>;
      };
    };
    expect((await provider.getVideoStatus(value.video)).status).toBe(
      'WAITING_UPLOAD',
    );
    await fetch(value.uploadInstructions[0]!.uploadUrl, {
      method: 'PUT',
      body: Buffer.alloc(4),
    });
    await fetch(`${sandbox.urls.linkedin}/v2/videos?action=finalizeUpload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        finalizeUploadRequest: {
          video: value.video,
          uploadToken: '',
          uploadedPartIds: [],
        },
      }),
    });
    expect((await provider.getVideoStatus(value.video)).status).toBe(
      'PROCESSING',
    );
    skew += 10_000;
    expect((await provider.getVideoStatus(value.video)).status).toBe(
      'AVAILABLE',
    );
  });

  it('publishes a video through the provider end to end', async () => {
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    const result = await new LinkedInProvider(tokens.access_token).uploadVideo({
      videoPath: videoFile,
      text: 'The keeper’s last night.',
      visibility: 'PUBLIC',
      authorUrn,
    });
    expect(result.postUrn).toMatch(/^urn:li:share:/);
  });

  it('deletes a post through the provider; deleting it again is a no-op, as LinkedIn documents', async () => {
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    const provider = new LinkedInProvider(tokens.access_token);
    await provider.deletePost(textPostUrn);
    expect(sandbox.social.hasObject('linkedin', textPostUrn)).toBe(false);
    await expect(provider.deletePost(textPostUrn)).resolves.toBeUndefined();
  });

  it('an access token lasts 60 days; refresh returns a new one and keeps the refresh token', async () => {
    skew += 61 * DAY;
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    await expect(
      new LinkedInProvider(tokens.access_token).getUserInfo(),
    ).rejects.toThrow(/has expired/);

    const refreshed = await refreshLinkedIn(tokens.refresh_token!);
    expect(refreshed.status).toBe(200);
    const next = refreshed.body as LinkedInTokens;
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).toBe(tokens.refresh_token);
    expect(next.expires_in).toBe(60 * 24 * 60 * 60);
    expect(next.refresh_token_expires_in).toBeLessThan(365 * 24 * 60 * 60);
    expect(
      (await new LinkedInProvider(next.access_token).getUserInfo()).sub,
    ).toBeTruthy();
    tokens = { ...tokens, ...next };
  });

  it('when the member removes the app at LinkedIn, calls fail as revoked and refresh is refused (the app has no LinkedIn revoke to call: KB-25)', async () => {
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    sandbox.social.revoke(tokens.access_token);
    await expect(
      new LinkedInProvider(tokens.access_token).getUserInfo(),
    ).rejects.toThrow(/revoked by the user/);
    expect((await refreshLinkedIn(tokens.refresh_token!)).status).toBe(400);
  });

  it('a connection without w_member_social can read its profile but not post: the vendor’s ACCESS_DENIED', async () => {
    const readOnly = await connectedLinkedIn(sandbox, {
      granted: ['openid', 'profile', 'email'],
    });
    expect(readOnly.scope).not.toContain('w_member_social');
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    const provider = new LinkedInProvider(readOnly.access_token);
    expect((await provider.getUserInfo()).sub).toBe(
      authorUrn.replace('urn:li:person:', ''),
    );
    await expect(
      provider.createTextPost({
        text: 'Not allowed.',
        visibility: 'PUBLIC',
        authorUrn,
      }),
    ).rejects.toThrow(/ACCESS_DENIED/);
  });

  it('a token request with a different scope set invalidates the earlier access tokens, as LinkedIn documents', async () => {
    const first = await connectedLinkedIn(sandbox);
    const { LinkedInProvider } = await import(
      '@kit/publishing/providers/linkedin'
    );
    expect(
      (await new LinkedInProvider(first.access_token).getUserInfo()).sub,
    ).toBeTruthy();

    await connectedLinkedIn(sandbox, { granted: ['openid', 'profile'] });
    await expect(
      new LinkedInProvider(first.access_token).getUserInfo(),
    ).rejects.toThrow(/revoked by the user/);
  });
});
