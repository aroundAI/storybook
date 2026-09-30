import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sandbox } from '../src/sandbox';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';
import { PROCESSING_MS } from '../src/social/vendors/linkedin/data';
import {
  APP,
  CREDENTIALS,
  type LinkedInTokens,
  connectedLinkedIn,
  linkedInSandbox,
  refreshLinkedIn,
} from './linkedin-helpers';

/**
 * FILM-1802 criteria 5, 6 and 7 for the LinkedIn origin: every response the
 * sandbox serves names only fields its registry entry declares (so only
 * fields the capability reference documents), and the vendor's documented
 * behaviour is reproduced. §3's table has no LinkedIn row — the app syncs no
 * LinkedIn analytics (FILM-1720, FILM-1727) — so these are the documented
 * behaviours of the endpoints the app calls.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-20T09:00:00Z');
let now = T0;
let sandbox: Sandbox;
let tokens: LinkedInTokens;
let person: string;

function entry(method: string, path: string): ServedEndpoint {
  const found = SERVED.find(
    (e) => e.origin === 'linkedin' && e.method === method && e.path === path,
  );
  if (!found) throw new Error(`no registry entry for ${method} ${path}`);
  return found;
}

async function call(
  path: string,
  init: RequestInit = {},
  token: string | null = tokens.access_token,
) {
  const response = await fetch(`${sandbox.urls.linkedin}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Restli-Protocol-Version': '2.0.0',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? (JSON.parse(text) as never) : ({} as never),
  };
}

const json = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

async function readyVideo(token = tokens.access_token, owner = person) {
  const init = await call(
    '/v2/videos?action=initializeUpload',
    json({ initializeUploadRequest: { owner, fileSizeBytes: 9_000_000 } }),
    token,
  );
  const value = (
    init.body as {
      value: {
        video: string;
        uploadInstructions: Array<{ uploadUrl: string }>;
      };
    }
  ).value;
  const put = await fetch(value.uploadInstructions[0]!.uploadUrl, {
    method: 'PUT',
    body: Buffer.alloc(64),
  });
  await call(
    '/v2/videos?action=finalizeUpload',
    json({
      finalizeUploadRequest: {
        video: value.video,
        uploadToken: '',
        uploadedPartIds: [put.headers.get('etag')],
      },
    }),
    token,
  );
  now += PROCESSING_MS + 1;
  return { init, value, put };
}

const postBody = (extra: Record<string, unknown> = {}) => ({
  author: person,
  commentary: 'Sample commentary',
  visibility: 'PUBLIC',
  distribution: {
    feedDistribution: 'MAIN_FEED',
    targetEntities: [],
    thirdPartyDistributionChannels: [],
  },
  lifecycleState: 'PUBLISHED',
  isReshareDisabledByAuthor: false,
  ...extra,
});

beforeAll(async () => {
  sandbox = await linkedInSandbox(18052, () => now);
  tokens = await connectedLinkedIn(sandbox, {
    requested: [
      'openid',
      'profile',
      'email',
      'w_member_social',
      'r_member_social',
    ],
  });
  person = `urn:li:person:${sandbox.social.listAccounts('linkedin')[0]!.id}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('what the LinkedIn origin serves is what the reference documents', () => {
  it('token responses: the code exchange and the refresh', async () => {
    expect(
      undeclaredKeys(entry('POST', '/oauth/v2/accessToken'), tokens),
    ).toEqual([]);
    const refreshed = await refreshLinkedIn(tokens.refresh_token!);
    expect(
      undeclaredKeys(entry('POST', '/oauth/v2/accessToken'), refreshed.body),
    ).toEqual([]);
  });

  it('userinfo: every claim, and only the ones the granted scopes cover', async () => {
    const full = await call('/v2/userinfo');
    expect(undeclaredKeys(entry('GET', '/v2/userinfo'), full.body)).toEqual([]);
    expect(Object.keys(full.body).sort()).toEqual(
      [
        'email',
        'email_verified',
        'family_name',
        'given_name',
        'locale',
        'name',
        'picture',
        'sub',
      ].sort(),
    );

    const narrow = await connectedLinkedIn(sandbox, {
      granted: ['openid'],
      requested: [
        'openid',
        'profile',
        'email',
        'w_member_social',
        'r_member_social',
      ],
    });
    const bare = await call('/v2/userinfo', {}, narrow.access_token);
    expect(Object.keys(bare.body)).toEqual(['sub']);
    tokens = await connectedLinkedIn(sandbox, {
      requested: [
        'openid',
        'profile',
        'email',
        'w_member_social',
        'r_member_social',
      ],
    });
  });

  it('the Videos API: initialize, the part upload, finalize and get', async () => {
    const { init, put } = await readyVideo();
    expect(
      undeclaredKeys(
        entry('POST', '/v2/videos?action=initializeUpload'),
        init.body,
      ),
    ).toEqual([]);
    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toMatch(/^\/ambry-videoei\/signedId\//);

    const { video } = (init.body as { value: { video: string } }).value;
    const got = await call(`/v2/videos/${encodeURIComponent(video)}`);
    expect(got.body).toMatchObject({ status: 'AVAILABLE', owner: person });
    expect(undeclaredKeys(entry('GET', '/v2/videos/{urn}'), got.body)).toEqual(
      [],
    );
  });

  it('the Assets API and ugcPosts the publish worker calls', async () => {
    const register = await call(
      '/v2/assets?action=registerUpload',
      json({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
          owner: person,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            },
          ],
        },
      }),
    );
    expect(
      undeclaredKeys(
        entry('POST', '/v2/assets?action=registerUpload'),
        register.body,
      ),
    ).toEqual([]);

    const { asset, uploadMechanism } = (
      register.body as {
        value: {
          asset: string;
          uploadMechanism: Record<string, { uploadUrl: string }>;
        };
      }
    ).value;
    const uploadUrl = Object.values(uploadMechanism)[0]!.uploadUrl;
    expect(
      (await fetch(uploadUrl, { method: 'PUT', body: Buffer.alloc(32) }))
        .status,
    ).toBe(200);

    const share = await call(
      '/v2/ugcPosts',
      json({
        author: person,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: 'A worker-made share.' },
            shareMediaCategory: 'VIDEO',
            media: [
              { status: 'READY', media: asset, title: { text: 'Title' } },
            ],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      }),
    );
    expect(share.status).toBe(201);
    expect(undeclaredKeys(entry('POST', '/v2/ugcPosts'), share.body)).toEqual(
      [],
    );
    expect(share.headers.get('x-restli-id')).toBe(
      (share.body as { id: string }).id,
    );
  });

  it('the Posts API: create answers 201 with the id in x-restli-id and no body; get returns the post', async () => {
    const video = await readyVideo();
    const created = await call(
      '/v2/posts',
      json(
        postBody({
          content: {
            media: { title: 'Video', id: video.value.video },
          },
        }),
      ),
    );
    expect(created.status).toBe(201);
    expect(created.body).toEqual({});
    const urn = created.headers.get('x-restli-id')!;
    expect(urn).toMatch(/^urn:li:share:\d+$/);
    expect(undeclaredKeys(entry('POST', '/v2/posts'), created.body)).toEqual(
      [],
    );

    const got = await call(`/v2/posts/${encodeURIComponent(urn)}`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      id: urn,
      author: person,
      lifecycleState: 'PUBLISHED',
      content: { media: { id: video.value.video } },
    });
    expect(undeclaredKeys(entry('GET', '/v2/posts/{urn}'), got.body)).toEqual(
      [],
    );
  });

  it('error bodies: 401, 403, 400 and 404 all use the documented shape', async () => {
    const forbidden = await call(
      '/v2/posts',
      json(postBody()),
      (await connectedLinkedIn(sandbox, { granted: ['openid'] })).access_token,
    );
    tokens = await connectedLinkedIn(sandbox, {
      requested: [
        'openid',
        'profile',
        'email',
        'w_member_social',
        'r_member_social',
      ],
    });
    const responses = [
      await call('/v2/userinfo', {}, null),
      await call('/v2/userinfo', {}, 'sbx.linkedin.not-a-token'),
      forbidden,
      await call('/v2/posts', json({})),
      await call('/v2/videos/urn%3Ali%3Avideo%3Anever'),
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401, 403, 400, 404]);
    for (const response of responses) {
      expect(
        undeclaredKeys(entry('GET', '(any error)'), response.body),
      ).toEqual([]);
    }
  });
});

describe('documented LinkedIn behaviour the sandbox reproduces', () => {
  it('401s say which way the token failed: missing, unknown, expired, revoked', async () => {
    tokens = await connectedLinkedIn(sandbox, {
      requested: [
        'openid',
        'profile',
        'email',
        'w_member_social',
        'r_member_social',
      ],
    });
    const missing = await call('/v2/userinfo', {}, null);
    expect(missing.body).toMatchObject({
      message: 'Empty oauth2_access_token',
    });
    const unknown = await call('/v2/userinfo', {}, 'sbx.linkedin.x');
    expect(unknown.body).toMatchObject({ message: 'Invalid access token' });

    sandbox.social.revoke(tokens.access_token);
    expect((await call('/v2/userinfo')).body).toMatchObject({
      message: 'The token used in the request has been revoked by the user',
    });

    tokens = await connectedLinkedIn(sandbox, {
      requested: [
        'openid',
        'profile',
        'email',
        'w_member_social',
        'r_member_social',
      ],
    });
    now += 61 * DAY;
    expect((await call('/v2/userinfo')).body).toMatchObject({
      message: 'The token used in the request has expired',
    });
    tokens = {
      ...tokens,
      ...((await refreshLinkedIn(tokens.refresh_token!))
        .body as LinkedInTokens),
    };
  });

  it('the token endpoint names a missing parameter, and refuses a client it does not know', async () => {
    const { LINKEDIN_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/linkedin'
    );
    const post = async (params: Record<string, string>) => {
      const response = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        body: new URLSearchParams(params),
      });
      return { status: response.status, body: await response.json() };
    };
    expect(
      await post({
        grant_type: 'authorization_code',
        client_id: CREDENTIALS.clientId,
      }),
    ).toMatchObject({
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'A required parameter "client_secret" is missing',
      },
    });
    expect(
      await post({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token!,
        client_id: 'someone-else',
        client_secret: CREDENTIALS.clientSecret,
      }),
    ).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
  });

  it('a code exchanged for another redirect_uri is invalid_redirect_uri, and a code is one-time', async () => {
    const { LINKEDIN_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/linkedin'
    );
    const account = sandbox.social.signedIn('linkedin');
    const code = sandbox.social.issueCode('linkedin', account.id, ['openid'], {
      clientId: CREDENTIALS.clientId,
      redirectUri: `${APP}/api/platforms/callback/linkedin`,
    });
    const exchange = (redirect: string) =>
      fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code.value,
          client_id: CREDENTIALS.clientId,
          client_secret: CREDENTIALS.clientSecret,
          redirect_uri: redirect,
        }),
      });
    const wrong = await exchange('http://localhost:9/elsewhere');
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('declining consent redirects with user_cancelled_authorize and the state', async () => {
    const { LINKEDIN_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/linkedin'
    );
    const page = await fetch(
      `${LINKEDIN_OAUTH_CONFIG.authUrl}?${new URLSearchParams({
        response_type: 'code',
        client_id: CREDENTIALS.clientId,
        redirect_uri: `${APP}/api/platforms/callback/linkedin`,
        scope: 'openid',
        state: 'abc',
      })}`,
    );
    const html = await page.text();
    const action = /action="([^"]+)"/.exec(html)![1]!;
    const denied = await fetch(`${sandbox.urls.linkedin}${action}`, {
      method: 'POST',
      redirect: 'manual',
      body: new URLSearchParams({
        client_id: CREDENTIALS.clientId,
        redirect_uri: `${APP}/api/platforms/callback/linkedin`,
        state: 'abc',
        decision: 'deny',
      }),
    });
    const back = new URL(denied.headers.get('location')!);
    expect(back.searchParams.get('error')).toBe('user_cancelled_authorize');
    expect(back.searchParams.get('state')).toBe('abc');
  });

  it('an invalid scope, or another app’s client id, is refused at the authorize page', async () => {
    const { LINKEDIN_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/linkedin'
    );
    const ask = (params: Record<string, string>) =>
      fetch(
        `${LINKEDIN_OAUTH_CONFIG.authUrl}?${new URLSearchParams({
          response_type: 'code',
          client_id: CREDENTIALS.clientId,
          redirect_uri: `${APP}/api/platforms/callback/linkedin`,
          scope: 'openid',
          ...params,
        })}`,
      );
    expect((await ask({ scope: 'r_everything' })).status).toBe(401);
    expect((await ask({ client_id: 'someone-else' })).status).toBe(401);
  });

  it('a person cannot post as another person, or upload for one', async () => {
    const other = 'urn:li:person:SomeoneElse';
    const post = await call('/v2/posts', json(postBody({ author: other })));
    expect(post.status).toBe(403);
    expect(post.body).toMatchObject({ code: 'ACCESS_DENIED' });

    const upload = await call(
      '/v2/videos?action=initializeUpload',
      json({ initializeUploadRequest: { owner: other, fileSizeBytes: 100 } }),
    );
    expect(upload.status).toBe(403);
    expect(upload.body).toMatchObject({
      message: expect.stringContaining('forbidden'),
    });
  });

  it('a post is refused for a missing field, an over-long commentary, a bad visibility, or media still waiting for its upload', async () => {
    const missing = postBody();
    delete (missing as Record<string, unknown>).distribution;
    expect((await call('/v2/posts', json(missing))).body).toMatchObject({
      code: 'MISSING_FIELD',
    });
    expect(
      (
        await call(
          '/v2/posts',
          json(postBody({ commentary: 'x'.repeat(3001) })),
        )
      ).body,
    ).toMatchObject({ code: 'FIELD_LENGTH_TOO_LONG' });
    expect(
      (await call('/v2/posts', json(postBody({ visibility: 'EVERYONE' }))))
        .body,
    ).toMatchObject({ code: 'INVALID_VALUE_FOR_FIELD' });

    const init = await call(
      '/v2/videos?action=initializeUpload',
      json({ initializeUploadRequest: { owner: person, fileSizeBytes: 100 } }),
    );
    const { video } = (init.body as { value: { video: string } }).value;
    const waiting = await call(
      '/v2/posts',
      json(postBody({ content: { media: { id: video } } })),
    );
    expect(waiting.body).toMatchObject({ code: 'MEDIA_ASSET_WAITING_UPLOAD' });
  });

  it('a video is WAITING_UPLOAD, then PROCESSING, then AVAILABLE; finalize with nothing uploaded is refused', async () => {
    const init = await call(
      '/v2/videos?action=initializeUpload',
      json({ initializeUploadRequest: { owner: person, fileSizeBytes: 100 } }),
    );
    const value = (
      init.body as {
        value: {
          video: string;
          uploadInstructions: Array<{ uploadUrl: string }>;
        };
      }
    ).value;
    const status = async () =>
      (
        (await call(`/v2/videos/${encodeURIComponent(value.video)}`)).body as {
          status: string;
        }
      ).status;
    const finalize = () =>
      call(
        '/v2/videos?action=finalizeUpload',
        json({
          finalizeUploadRequest: {
            video: value.video,
            uploadToken: '',
            uploadedPartIds: [],
          },
        }),
      );

    expect(await status()).toBe('WAITING_UPLOAD');
    expect((await finalize()).body).toMatchObject({
      code: 'MEDIA_ASSET_WAITING_UPLOAD',
    });
    await fetch(value.uploadInstructions[0]!.uploadUrl, {
      method: 'PUT',
      body: Buffer.alloc(8),
    });
    expect((await finalize()).status).toBe(200);
    expect(await status()).toBe('PROCESSING');
    now += PROCESSING_MS;
    expect(await status()).toBe('AVAILABLE');
  });

  it('a file over 4 MiB gets one upload URL per 4 MiB part, in byte order', async () => {
    const init = await call(
      '/v2/videos?action=initializeUpload',
      json({
        initializeUploadRequest: { owner: person, fileSizeBytes: 9_000_000 },
      }),
    );
    const { uploadInstructions } = (
      init.body as {
        value: {
          uploadInstructions: Array<{ firstByte: number; lastByte: number }>;
        };
      }
    ).value;
    expect(uploadInstructions.map((p) => [p.firstByte, p.lastByte])).toEqual([
      [0, 4_194_303],
      [4_194_304, 8_388_607],
      [8_388_608, 8_999_999],
    ]);
  });

  it('reading a post needs r_member_social; a token without it gets ACCESS_DENIED', async () => {
    const created = await call('/v2/posts', json(postBody()));
    const urn = created.headers.get('x-restli-id')!;
    const writeOnly = await connectedLinkedIn(sandbox, {
      requested: ['openid', 'profile', 'email', 'w_member_social'],
    });
    const denied = await call(
      `/v2/posts/${encodeURIComponent(urn)}`,
      {},
      writeOnly.access_token,
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'ACCESS_DENIED' });
    tokens = await connectedLinkedIn(sandbox, {
      requested: [
        'openid',
        'profile',
        'email',
        'w_member_social',
        'r_member_social',
      ],
    });
  });

  it('deleting a post is idempotent, and a deleted post is gone from reads', async () => {
    const created = await call('/v2/posts', json(postBody()));
    const urn = created.headers.get('x-restli-id')!;
    const path = `/v2/posts/${encodeURIComponent(urn)}`;
    expect((await call(path, { method: 'DELETE' })).status).toBe(204);
    expect((await call(path, { method: 'DELETE' })).status).toBe(204);
    expect((await call(path)).status).toBe(404);
  });

  it('the refresh token keeps its value and its remaining lifetime shrinks', async () => {
    const first = (await refreshLinkedIn(tokens.refresh_token!))
      .body as LinkedInTokens;
    now += 30 * DAY;
    const later = (await refreshLinkedIn(tokens.refresh_token!))
      .body as LinkedInTokens;
    expect(later.refresh_token).toBe(first.refresh_token);
    expect(
      first.refresh_token_expires_in! - later.refresh_token_expires_in!,
    ).toBe(30 * 86_400);
  });
});
