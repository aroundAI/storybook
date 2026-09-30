import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sandbox } from '../src/sandbox';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';
import {
  DISPLAY_VIDEO_FIELDS,
  FREEZE_AFTER_MS,
  MAX_QUERY_IDS,
  PROCESSING_MS,
} from '../src/social/vendors/tiktok/data';
import {
  CREDENTIALS,
  type TikTokTokens,
  connectedTikTok,
  refreshTikTok,
  tiktokSandbox,
} from './tiktok-helpers';

/**
 * FILM-1802 criteria 5, 6 and 7 for the TikTok origin: every response the
 * sandbox serves names only fields its registry entry declares (so only
 * fields the capability reference documents), and the TikTok row of §3's
 * table is reproduced: every response carries `error` and success is
 * `error.code: "ok"`, at most 20 ids to `video/query`, data that stops
 * updating 365 days after publish, and no retention curve, saves or watch
 * time on the Display API.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-20T09:00:00Z');
let now = T0;
let sandbox: Sandbox;
let tokens: TikTokTokens;

const ALL_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'user.info.stats',
  'video.list',
  'video.upload',
  'video.publish',
];

function entry(method: string, path: string): ServedEndpoint {
  const found = SERVED.find(
    (e) => e.origin === 'tiktok' && e.method === method && e.path === path,
  );
  if (!found) throw new Error(`no registry entry for ${method} ${path}`);
  return found;
}

/** The v2 envelope, as the tests read it: every field they touch, present. */
interface Envelope {
  data: {
    videos: Array<Record<string, number | string>>;
    publish_id: string;
    upload_url: string;
    status: string;
    publicaly_available_post_id: string[];
  };
  error: { code: string; message: string; log_id: string };
}

async function call(
  path: string,
  init: RequestInit = {},
  token = tokens.access_token,
) {
  const response = await fetch(`${sandbox.urls.tiktok}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text ? JSON.parse(text) : {}) as Envelope,
  };
}

const json = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

const DIRECT = { title: 'A short film', privacy_level: 'SELF_ONLY' };

async function publishDirect(title = 'A short film about the harbour') {
  const init = await call(
    '/v2/post/publish/video/init/',
    json({
      post_info: { ...DIRECT, title },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: 'https://cdn.example.org/a.mp4',
      },
    }),
  );
  const publishId = (init.body as { data: { publish_id: string } }).data
    .publish_id;
  now += PROCESSING_MS + 1;
  const status = await call(
    '/v2/post/publish/status/fetch/',
    json({ publish_id: publishId }),
  );
  const id = (
    status.body as { data: { publicaly_available_post_id: string[] } }
  ).data.publicaly_available_post_id[0]!;
  return { init, status, publishId, id };
}

async function refreshed() {
  tokens = (await refreshTikTok(tokens.refresh_token)).body;
}

beforeAll(async () => {
  sandbox = await tiktokSandbox(18062, () => now);
  tokens = await connectedTikTok(sandbox, { requested: ALL_SCOPES });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('what the TikTok origin serves is what the reference documents', () => {
  it('token responses: the code exchange and the refresh', async () => {
    expect(undeclaredKeys(entry('POST', '/v2/oauth/token/'), tokens)).toEqual(
      [],
    );
    const next = await refreshTikTok(tokens.refresh_token);
    expect(
      undeclaredKeys(entry('POST', '/v2/oauth/token/'), next.body),
    ).toEqual([]);
    tokens = next.body;
  });

  it('user info: every field of all three scopes', async () => {
    const result = await call(
      '/v2/user/info/?fields=open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name,bio_description,profile_deep_link,is_verified,username,follower_count,following_count,likes_count,video_count',
    );
    expect(result.status).toBe(200);
    expect(undeclaredKeys(entry('GET', '/v2/user/info/'), result.body)).toEqual(
      [],
    );
  });

  it('video query: every Display API field', async () => {
    const { id } = await publishDirect();
    const result = await call(
      `/v2/video/query/?fields=${DISPLAY_VIDEO_FIELDS.join(',')}`,
      json({ filters: { video_ids: [id] } }),
    );
    expect(result.status).toBe(200);
    expect(
      undeclaredKeys(entry('POST', '/v2/video/query/'), result.body),
    ).toEqual([]);
    expect(Object.keys(result.body.data.videos[0]!).sort()).toEqual(
      [...DISPLAY_VIDEO_FIELDS].sort(),
    );
  });

  it('the inbox init, the direct init, the status and the error bodies', async () => {
    const inbox = await call(
      '/v2/post/publish/inbox/video/init/',
      json({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: 10,
          chunk_size: 10,
          total_chunk_count: 1,
        },
      }),
    );
    expect(
      undeclaredKeys(
        entry('POST', '/v2/post/publish/inbox/video/init/'),
        inbox.body,
      ),
    ).toEqual([]);

    const { init, status } = await publishDirect();
    expect(
      undeclaredKeys(entry('POST', '/v2/post/publish/video/init/'), init.body),
    ).toEqual([]);
    expect(
      undeclaredKeys(
        entry('POST', '/v2/post/publish/status/fetch/'),
        status.body,
      ),
    ).toEqual([]);

    const bad = await call('/v2/user/info/?fields=nonsense');
    const invalid = await call(
      '/v2/user/info/?fields=open_id',
      {},
      'sbx.tiktok.x',
    );
    const scope = await call(
      '/v2/user/info/?fields=follower_count',
      {},
      (
        await connectedTikTok(sandbox, {
          granted: ['user.info.basic'],
          requested: ALL_SCOPES,
        })
      ).access_token,
    );
    for (const response of [bad, invalid, scope]) {
      expect(
        undeclaredKeys(entry('GET', '(any error)'), response.body),
      ).toEqual([]);
    }
  });
});

describe('§3: TikTok behaviour the sandbox must reproduce', () => {
  it('every response carries error, and success is error.code "ok"', async () => {
    await refreshed();
    const responses = [
      await call('/v2/user/info/?fields=open_id'),
      await call(
        '/v2/video/query/?fields=id',
        json({ filters: { video_ids: ['7000000000000000001'] } }),
      ),
      await call(
        '/v2/post/publish/inbox/video/init/',
        json({
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: 'https://cdn.example.org/a.mp4',
          },
        }),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.error).toMatchObject({ code: 'ok', message: '' });
      expect(response.body.error.log_id).toMatch(/^\d{14}[0-9A-F]+$/);
    }

    const failed = await call(
      '/v2/user/info/?fields=open_id',
      {},
      'sbx.tiktok.nope',
    );
    expect(failed.status).toBe(401);
    expect(failed.body.error.code).toBe('access_token_invalid');
    // The human message does not contain the code.
    expect(failed.body.error.message).not.toContain('access_token_invalid');
  });

  it('video query takes at most 20 ids', async () => {
    const ids = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `700000000000000${String(i).padStart(4, '0')}`,
      );
    const within = await call(
      '/v2/video/query/?fields=id',
      json({ filters: { video_ids: ids(MAX_QUERY_IDS) } }),
    );
    expect(within.status).toBe(200);
    expect(within.body.data.videos).toHaveLength(MAX_QUERY_IDS);

    const over = await call(
      '/v2/video/query/?fields=id',
      json({ filters: { video_ids: ids(MAX_QUERY_IDS + 1) } }),
    );
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('invalid_params');
  });

  it('data stops updating 365 days after publish', async () => {
    const { id } = await publishDirect('Everything ends, and the counts stop.');
    const views = async () => {
      await refreshed();
      const result = await call(
        '/v2/video/query/?fields=id,view_count,like_count',
        json({ filters: { video_ids: [id] } }),
      );
      return result.body.data.videos[0] as {
        view_count: number;
        like_count: number;
      };
    };
    const object = sandbox.social.object('tiktok', id);

    now = object.publishedMs + 200 * DAY;
    const before = await views();
    now = object.publishedMs + FREEZE_AFTER_MS + 30 * DAY;
    const after = await views();
    now = object.publishedMs + FREEZE_AFTER_MS + 300 * DAY;
    const later = await views();
    expect(after).toEqual(later);
    expect(after.view_count).toBeGreaterThanOrEqual(before.view_count);
  });

  it('the Display API has no retention curve, saves, watch time, or the Business API’s fields', async () => {
    const { id } = await publishDirect('Fields that do not exist.');
    for (const field of [
      'save_count',
      'favorites_count',
      'average_time_watched',
      'total_time_watched',
      'full_video_watched_rate',
      'reach',
      'impression_sources',
      'traffic_source_types',
      'audience_countries',
      'retention',
    ]) {
      const result = await call(
        `/v2/video/query/?fields=id,${field}`,
        json({ filters: { video_ids: [id] } }),
      );
      expect(result.status, field).toBe(400);
      expect(result.body.error.code, field).toBe('invalid_params');
      expect(result.body, field).not.toHaveProperty('data.videos');
    }
  });

  it('user info splits its fields across three scopes: a field without its scope is scope_not_authorized', async () => {
    const basic = await connectedTikTok(sandbox, {
      requested: ALL_SCOPES,
      granted: ['user.info.basic'],
    });
    const forBasic = (fields: string) =>
      call(`/v2/user/info/?fields=${fields}`, {}, basic.access_token);
    expect((await forBasic('open_id,display_name')).status).toBe(200);
    for (const field of ['follower_count', 'bio_description']) {
      const result = await forBasic(`open_id,${field}`);
      expect(result.status, field).toBe(401);
      expect(result.body.error.code, field).toBe('scope_not_authorized');
    }
    tokens = await connectedTikTok(sandbox, { requested: ALL_SCOPES });
  });

  it('video query needs video.list', async () => {
    const noList = await connectedTikTok(sandbox, {
      requested: ALL_SCOPES,
      granted: ['user.info.basic', 'video.upload'],
    });
    const result = await call(
      '/v2/video/query/?fields=id',
      json({ filters: { video_ids: ['7000000000000000001'] } }),
      noList.access_token,
    );
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('scope_not_authorized');
    tokens = await connectedTikTok(sandbox, { requested: ALL_SCOPES });
  });

  it('a video another account published is not in a token’s query', async () => {
    const { id } = await publishDirect('Mine, not yours.');
    const other = sandbox.social.createAccount('tiktok');
    const stranger = sandbox.social.issueTokens('tiktok', other.id, [
      'video.list',
    ]);
    const result = await call(
      '/v2/video/query/?fields=id',
      json({ filters: { video_ids: [id] } }),
      stranger.access.value,
    );
    expect(result.body.data.videos).toEqual([]);
  });
});

describe('the Content Posting API as TikTok documents it', () => {
  it('inbox upload: init, chunks with Content-Range (206, then 201), then SEND_TO_USER_INBOX', async () => {
    const size = 10;
    const init = await call(
      '/v2/post/publish/inbox/video/init/',
      json({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: size,
          chunk_size: 5,
          total_chunk_count: 2,
        },
      }),
    );
    const { publish_id, upload_url } = init.body.data as {
      publish_id: string;
      upload_url: string;
    };
    expect(publish_id).toMatch(/^v_inbox_file~v2\./);
    expect(init.body.data).not.toHaveProperty('upload_id');

    const put = (start: number, end: number, bytes = end - start + 1) =>
      fetch(upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
        body: Buffer.alloc(bytes),
      });
    const statusOf = async () =>
      (await call('/v2/post/publish/status/fetch/', json({ publish_id }))).body
        .data.status;

    expect(await statusOf()).toBe('PROCESSING_UPLOAD');
    expect((await put(5, 9)).status).toBe(416);
    expect((await put(0, 4)).status).toBe(206);
    expect(await statusOf()).toBe('PROCESSING_UPLOAD');
    expect((await put(5, 9)).status).toBe(201);
    expect(await statusOf()).toBe('SEND_TO_USER_INBOX');
    expect((await put(0, 4, 3)).status).toBe(400);
  });

  it('direct post: PROCESSING_UPLOAD then PUBLISH_COMPLETE with the post id; no id before then', async () => {
    const init = await call(
      '/v2/post/publish/video/init/',
      json({
        post_info: DIRECT,
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: 'https://cdn.example.org/b.mp4',
        },
      }),
    );
    const publishId = init.body.data.publish_id as string;
    expect(publishId).toMatch(/^v_pub_url~v2\./);
    const first = await call(
      '/v2/post/publish/status/fetch/',
      json({ publish_id: publishId }),
    );
    expect(first.body.data.status).toBe('PROCESSING_DOWNLOAD');
    expect(first.body.data).not.toHaveProperty('publicaly_available_post_id');

    now += PROCESSING_MS;
    const done = await call(
      '/v2/post/publish/status/fetch/',
      json({ publish_id: publishId }),
    );
    expect(done.body.data.status).toBe('PUBLISH_COMPLETE');
    expect(done.body.data.publicaly_available_post_id).toHaveLength(1);
  });

  it('the inbox init needs video.upload and the direct post needs video.publish', async () => {
    const uploadOnly = await connectedTikTok(sandbox, {
      requested: ALL_SCOPES,
      granted: ['user.info.basic', 'video.upload'],
    });
    const publishOnly = await connectedTikTok(sandbox, {
      requested: ALL_SCOPES,
      granted: ['user.info.basic', 'video.publish'],
    });
    const inbox = json({
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: 'https://cdn.example.org/c.mp4',
      },
    });
    const direct = json({
      post_info: DIRECT,
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: 'https://cdn.example.org/c.mp4',
      },
    });
    expect(
      (
        await call(
          '/v2/post/publish/video/init/',
          direct,
          uploadOnly.access_token,
        )
      ).body.error.code,
    ).toBe('scope_not_authorized');
    expect(
      (
        await call(
          '/v2/post/publish/inbox/video/init/',
          inbox,
          publishOnly.access_token,
        )
      ).body.error.code,
    ).toBe('scope_not_authorized');
    expect(
      (
        await call(
          '/v2/post/publish/inbox/video/init/',
          inbox,
          uploadOnly.access_token,
        )
      ).status,
    ).toBe(200);
    tokens = await connectedTikTok(sandbox, { requested: ALL_SCOPES });
  });

  it('a direct post needs a privacy_level the creator offers; an inbox init needs FILE_UPLOAD sizes; a publish_id is its owner’s', async () => {
    const badPrivacy = await call(
      '/v2/post/publish/video/init/',
      json({
        post_info: { title: 'x', privacy_level: 'PUBLIC' },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: 'https://cdn.example.org/d.mp4',
        },
      }),
    );
    expect(badPrivacy.body.error.code).toBe('invalid_params');

    const noSizes = await call(
      '/v2/post/publish/inbox/video/init/',
      json({ source_info: { source: 'FILE_UPLOAD' } }),
    );
    expect(noSizes.body.error.code).toBe('invalid_params');

    const { publishId } = await publishDirect('Owned by its publisher.');
    const other = sandbox.social.createAccount('tiktok');
    const stranger = sandbox.social.issueTokens('tiktok', other.id, [
      'video.publish',
    ]);
    const foreign = await call(
      '/v2/post/publish/status/fetch/',
      json({ publish_id: publishId }),
      stranger.access.value,
    );
    expect(foreign.body.error.code).toBe('invalid_publish_id');
  });
});

describe('TikTok Login Kit as documented', () => {
  const post = async (path: string, params: Record<string, string>) => {
    const response = await fetch(`${sandbox.urls.tiktok}${path}`, {
      method: 'POST',
      body: new URLSearchParams(params),
    });
    return { status: response.status, body: (await response.json()) as never };
  };

  it('the token endpoint names a missing parameter and refuses a client it does not know', async () => {
    expect(
      (
        await post('/v2/oauth/token/', {
          grant_type: 'refresh_token',
          client_key: CREDENTIALS.clientId,
        })
      ).body,
    ).toMatchObject({ error: 'invalid_request' });
    expect(
      (
        await post('/v2/oauth/token/', {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_key: 'someoneelse',
          client_secret: CREDENTIALS.clientSecret,
        })
      ).status,
    ).toBe(401);
  });

  it('revoke ends the whole grant', async () => {
    const grant = await connectedTikTok(sandbox);
    const response = await post('/v2/oauth/revoke/', {
      client_key: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
      token: grant.access_token,
    });
    expect(response.status).toBe(200);
    expect(
      (await call('/v2/user/info/?fields=open_id', {}, grant.access_token))
        .status,
    ).toBe(401);
    expect((await refreshTikTok(grant.refresh_token)).status).toBe(400);
    tokens = await connectedTikTok(sandbox, { requested: ALL_SCOPES });
  });

  it('an unknown scope and an unknown client key at the authorize page', async () => {
    const { TIKTOK_OAUTH_CONFIG } = await import(
      '@kit/publishing/oauth/tiktok'
    );
    const ask = (
      params: Record<string, string>,
      redirect: RequestRedirect = 'manual',
    ) =>
      fetch(
        `${TIKTOK_OAUTH_CONFIG.authUrl}?${new URLSearchParams({
          client_key: CREDENTIALS.clientId,
          redirect_uri: 'http://localhost:3132/api/platforms/callback/tiktok',
          response_type: 'code',
          scope: 'user.info.basic',
          state: 'abc',
          ...params,
        })}`,
        { redirect },
      );
    const badScope = await ask({ scope: 'video.everything' });
    expect(
      new URL(badScope.headers.get('location')!).searchParams.get('error'),
    ).toBe('invalid_scope');
    expect((await ask({ client_key: 'someoneelse' })).status).toBe(400);
  });
});
