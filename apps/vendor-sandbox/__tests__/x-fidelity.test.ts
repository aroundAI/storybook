import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sandbox } from '../src/sandbox';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';
import { MEDIA_PROCESSING_MS } from '../src/social/vendors/x/data';
import {
  type XTokens,
  connectedX,
  refreshX,
  revokeX,
  xSandbox,
} from './x-helpers';

/**
 * FILM-1802 criteria 5, 6 and 7 for the X origin: every response the sandbox
 * serves names only fields its registry entry declares (so only fields the
 * capability reference documents), and the X row of §3's table is
 * reproduced: non-public metrics only for posts under 30 days old, the two
 * quartile vocabularies on their own endpoints, and the Enterprise-only
 * endpoints answering with the tier error.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-20T09:00:00Z');
let now = T0;
let sandbox: Sandbox;
let tokens: XTokens;

function entry(method: string, path: string): ServedEndpoint {
  const found = SERVED.find(
    (e) => e.origin === 'x' && e.method === method && e.path === path,
  );
  if (!found) throw new Error(`no registry entry for ${method} ${path}`);
  return found;
}

async function call(
  path: string,
  init: RequestInit = {},
  token = tokens.access_token,
) {
  const response = await fetch(`${sandbox.urls.x}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as never) : ({} as never),
  };
}

const json = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

async function uploadMedia(token = tokens.access_token) {
  const bytes = Buffer.alloc(4096, 4);
  const init = await call(
    '/2/media/upload/initialize',
    json({
      media_type: 'video/mp4',
      total_bytes: bytes.length,
      media_category: 'tweet_video',
    }),
    token,
  );
  const id = (init.body as { data: { id: string } }).data.id;
  const form = new FormData();
  form.append('segment_index', '0');
  form.append('media', new Blob([bytes]));
  const append = await call(
    `/2/media/upload/${id}/append`,
    { method: 'POST', body: form },
    token,
  );
  const finalize = await call(
    `/2/media/upload/${id}/finalize`,
    { method: 'POST' },
    token,
  );
  return { id, init, append, finalize };
}

async function readyMedia() {
  const media = await uploadMedia();
  now += MEDIA_PROCESSING_MS + 1;
  return media;
}

async function post(text: string) {
  const media = await readyMedia();
  const created = await call(
    '/2/tweets',
    json({ text, media: { media_ids: [media.id] } }),
  );
  return {
    id: (created.body as { data: { id: string } }).data.id,
    created,
    media,
  };
}

const LOOKUP =
  'tweet.fields=created_at,author_id,public_metrics,non_public_metrics,organic_metrics&expansions=attachments.media_keys&media.fields=public_metrics,non_public_metrics,organic_metrics';

beforeAll(async () => {
  sandbox = await xSandbox(18042, () => now);
  tokens = await connectedX(sandbox);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('what the X origin serves is what the reference documents', () => {
  it('token responses: the code exchange, the refresh and the revoke', async () => {
    expect(undeclaredKeys(entry('POST', '/2/oauth2/token'), tokens)).toEqual(
      [],
    );
    const refreshed = await refreshX(tokens.refresh_token!);
    expect(
      undeclaredKeys(entry('POST', '/2/oauth2/token'), refreshed.body),
    ).toEqual([]);
    tokens = refreshed.body;

    const spare = await connectedX(sandbox);
    const revoked = await revokeX(spare.access_token);
    expect(
      undeclaredKeys(entry('POST', '/2/oauth2/revoke'), revoked.body),
    ).toEqual([]);
  });

  it('the user, the four upload steps, the post and its delete', async () => {
    const me = await call('/2/users/me?user.fields=profile_image_url');
    expect(undeclaredKeys(entry('GET', '/2/users/me'), me.body)).toEqual([]);

    const media = await uploadMedia();
    expect(
      undeclaredKeys(
        entry('POST', '/2/media/upload/initialize'),
        media.init.body,
      ),
    ).toEqual([]);
    expect(
      undeclaredKeys(
        entry('POST', '/2/media/upload/{id}/append'),
        media.append.body,
      ),
    ).toEqual([]);
    expect(
      undeclaredKeys(
        entry('POST', '/2/media/upload/{id}/finalize'),
        media.finalize.body,
      ),
    ).toEqual([]);
    expect(media.finalize.body).toMatchObject({
      data: { processing_info: { state: 'pending' } },
    });

    now += MEDIA_PROCESSING_MS / 2 + 1;
    const middle = await call(
      `/2/media/upload?command=STATUS&media_id=${media.id}`,
    );
    expect(middle.body).toMatchObject({
      data: { processing_info: { state: 'in_progress' } },
    });
    expect(
      undeclaredKeys(entry('GET', '/2/media/upload'), middle.body),
    ).toEqual([]);
    now += MEDIA_PROCESSING_MS;
    const done = await call(
      `/2/media/upload?command=STATUS&media_id=${media.id}`,
    );
    expect(done.body).toMatchObject({
      data: { processing_info: { state: 'succeeded', progress_percent: 100 } },
    });
    expect(undeclaredKeys(entry('GET', '/2/media/upload'), done.body)).toEqual(
      [],
    );

    const created = await call(
      '/2/tweets',
      json({ text: 'Salt on the window.', media: { media_ids: [media.id] } }),
    );
    expect(created.status).toBe(201);
    expect(undeclaredKeys(entry('POST', '/2/tweets'), created.body)).toEqual(
      [],
    );

    const id = (created.body as { data: { id: string } }).data.id;
    const deleted = await call(`/2/tweets/${id}`, { method: 'DELETE' });
    expect(deleted.body).toEqual({ data: { deleted: true } });
    expect(
      undeclaredKeys(entry('DELETE', '/2/tweets/{id}'), deleted.body),
    ).toEqual([]);
  });

  it('the posts lookup, single and batch, with every metric field and the media expansion', async () => {
    const { id } = await post('The night porter keeps a diary.');
    const single = await call(`/2/tweets/${id}?${LOOKUP}`);
    expect(single.status).toBe(200);
    expect(undeclaredKeys(entry('GET', '/2/tweets/{id}'), single.body)).toEqual(
      [],
    );

    const batch = await call(`/2/tweets?ids=${id}&${LOOKUP}`);
    expect(undeclaredKeys(entry('GET', '/2/tweets'), batch.body)).toEqual([]);
  });

  it('error bodies: 401, 403, 400, not found and the tier error all use the documented problem object', async () => {
    const unauthorized = await call('/2/users/me', {}, 'sbx.x.not-a-token');
    const forbidden = await call(
      '/2/tweets',
      json({ text: 'x' }),
      (await connectedX(sandbox, ['tweet.read', 'users.read'])).access_token,
    );
    const invalid = await call('/2/tweets', json({}));
    const missing = await call('/2/tweets/1700000000000000001');
    const tier = await call('/2/media/analytics?media_keys=7_1');
    for (const [status, response] of [
      [401, unauthorized],
      [403, forbidden],
      [400, invalid],
      [403, tier],
    ] as const) {
      expect(response.status).toBe(status);
      expect(
        undeclaredKeys(entry('GET', '(any error)'), response.body),
      ).toEqual([]);
    }
    expect(
      undeclaredKeys(entry('GET', '/2/tweets/{id}'), missing.body),
    ).toEqual([]);
  });
});

describe('§3: X behaviour the sandbox must reproduce', () => {
  it('non-public and organic metrics exist only for posts under 30 days old, gated on creation date', async () => {
    const { id } = await post('Twelve hours of harbour light.');
    const fresh = await call(`/2/tweets/${id}?${LOOKUP}`);
    const freshData = fresh.body as never as {
      data: Record<string, unknown>;
      includes: { media: Array<Record<string, unknown>> };
    };
    expect(freshData.data.non_public_metrics).toBeDefined();
    expect(freshData.data.organic_metrics).toBeDefined();
    expect(freshData.includes.media[0]!.non_public_metrics).toBeDefined();

    now += 29 * DAY;
    tokens = (await refreshX(tokens.refresh_token!)).body;
    const edge = await call(`/2/tweets/${id}?${LOOKUP}`);
    expect(
      (edge.body as { data: Record<string, unknown> }).data.non_public_metrics,
    ).toBeDefined();

    now += 2 * DAY;
    tokens = (await refreshX(tokens.refresh_token!)).body;
    const old = await call(`/2/tweets/${id}?${LOOKUP}`);
    const oldBody = old.body as {
      data: Record<string, unknown>;
      includes: { media: Array<Record<string, unknown>> };
    };
    expect(old.status).toBe(200);
    expect(oldBody.data.public_metrics).toBeDefined();
    expect(oldBody.data.non_public_metrics).toBeUndefined();
    expect(oldBody.data.organic_metrics).toBeUndefined();
    expect(oldBody.includes.media[0]!.non_public_metrics).toBeUndefined();
    expect(oldBody.includes.media[0]!.public_metrics).toBeDefined();
  });

  it('the window is the post’s creation date, not the range asked: a fresh post 40 days after an old one still has them', async () => {
    const { id } = await post('A newer post on the same account.');
    const result = await call(
      `/2/tweets/${id}?tweet.fields=non_public_metrics`,
    );
    expect(
      (result.body as { data: Record<string, unknown> }).data
        .non_public_metrics,
    ).toBeDefined();
  });

  it('another account’s post never carries non-public metrics', async () => {
    const { id } = await post('Only its author sees the private numbers.');
    const other = sandbox.social.createAccount('x');
    const stranger = sandbox.social.issueTokens('x', other.id, [
      'tweet.read',
      'users.read',
    ]);
    const result = await call(
      `/2/tweets/${id}?tweet.fields=public_metrics,non_public_metrics`,
      {},
      stranger.access.value,
    );
    const data = (result.body as { data: Record<string, unknown> }).data;
    expect(data.public_metrics).toBeDefined();
    expect(data.non_public_metrics).toBeUndefined();
  });

  it('the two quartile vocabularies live on their own endpoints: playback_N_count on the post lookup, playbackN on the Enterprise analytics endpoint', async () => {
    const { id } = await post('Quartiles, counted two ways.');
    const lookup = await call(`/2/tweets/${id}?${LOOKUP}`);
    const media = (
      lookup.body as {
        includes: {
          media: Array<{
            non_public_metrics: Record<string, number>;
            public_metrics: Record<string, number>;
            organic_metrics: Record<string, number>;
          }>;
        };
      }
    ).includes.media[0]!;
    const q = media.non_public_metrics;
    expect(Object.keys(q).sort()).toEqual(
      [
        'playback_0_count',
        'playback_100_count',
        'playback_25_count',
        'playback_50_count',
        'playback_75_count',
      ].sort(),
    );
    expect(q.playback_0_count).toBeGreaterThanOrEqual(q.playback_25_count!);
    expect(q.playback_25_count).toBeGreaterThanOrEqual(q.playback_50_count!);
    expect(q.playback_50_count).toBeGreaterThanOrEqual(q.playback_75_count!);
    expect(q.playback_75_count).toBeGreaterThanOrEqual(q.playback_100_count!);
    expect(media.public_metrics).toEqual({ view_count: q.playback_0_count });
    expect(media.public_metrics).not.toHaveProperty('playback_25_count');
    expect(JSON.stringify(lookup.body)).not.toMatch(
      /playback(25|50|75|_complete|_start)\b/,
    );

    const analytics = await call(
      '/2/media/analytics?media_keys=7_1&granularity=total&start_time=2026-09-01T00:00:00Z&end_time=2026-09-20T00:00:00Z&media_analytics.fields=playback25',
    );
    expect(analytics.body).not.toHaveProperty('data');
  });

  it('the Enterprise-only analytics endpoints answer with the tier error, whatever scopes the token holds', async () => {
    for (const path of [
      '/2/media/analytics?media_keys=7_1',
      '/2/tweets/analytics?ids=1',
    ]) {
      const result = await call(path);
      expect(result.status, path).toBe(403);
      expect(result.body, path).toMatchObject({
        reason: 'client-not-enrolled',
        title: 'Client Forbidden',
      });
    }
  });

  it('deleting a post that is not yours, or is already gone, answers deleted: false and touches nothing', async () => {
    const { id } = await post('Only its author may delete this.');
    const other = sandbox.social.createAccount('x');
    const stranger = sandbox.social.issueTokens('x', other.id, [
      'tweet.read',
      'tweet.write',
      'users.read',
    ]);
    const refused = await call(
      `/2/tweets/${id}`,
      { method: 'DELETE' },
      stranger.access.value,
    );
    expect(refused.body).toEqual({ data: { deleted: false } });
    expect(sandbox.social.hasObject('x', id)).toBe(true);

    await call(`/2/tweets/${id}`, { method: 'DELETE' });
    const again = await call(`/2/tweets/${id}`, { method: 'DELETE' });
    expect(again.body).toEqual({ data: { deleted: false } });
  });

  it('an access token lasts two hours; only offline.access gets a refresh token', async () => {
    const withoutOffline = await connectedX(sandbox, [
      'tweet.read',
      'users.read',
    ]);
    expect(withoutOffline.refresh_token).toBeUndefined();
    expect(withoutOffline.expires_in).toBe(7200);
  });

  it('the same text twice from one account is refused as duplicate content', async () => {
    await post('Posted once, and only once.');
    const media = await readyMedia();
    const again = await call(
      '/2/tweets',
      json({
        text: 'Posted once, and only once.',
        media: { media_ids: [media.id] },
      }),
    );
    expect(again.status).toBe(403);
    expect(again.body).toMatchObject({
      detail: expect.stringContaining('duplicate content'),
    });
  });

  it('a post cannot attach media that is still processing, or that another account uploaded', async () => {
    const early = await uploadMedia();
    const tooSoon = await call(
      '/2/tweets',
      json({ text: 'Too early.', media: { media_ids: [early.id] } }),
    );
    expect(tooSoon.status).toBe(400);

    now += MEDIA_PROCESSING_MS + 1;
    const other = sandbox.social.createAccount('x');
    const stranger = sandbox.social.issueTokens('x', other.id, [
      'tweet.read',
      'tweet.write',
      'users.read',
    ]);
    const theirs = await call(
      '/2/tweets',
      json({ text: 'Not their media.', media: { media_ids: [early.id] } }),
      stranger.access.value,
    );
    expect(theirs.status).toBe(400);
  });

  it('a chunk upload whose bytes do not add up to total_bytes cannot be finalized', async () => {
    const init = await call(
      '/2/media/upload/initialize',
      json({ media_type: 'video/mp4', total_bytes: 9000 }),
    );
    const id = (init.body as { data: { id: string } }).data.id;
    const form = new FormData();
    form.append('segment_index', '0');
    form.append('media', new Blob([Buffer.alloc(100)]));
    await call(`/2/media/upload/${id}/append`, { method: 'POST', body: form });
    const finalize = await call(`/2/media/upload/${id}/finalize`, {
      method: 'POST',
    });
    expect(finalize.status).toBe(400);
  });

  it('initialize takes a total_bytes from 0 to 17179869184, X’s documented range, and refuses past it', async () => {
    // https://docs.x.com/x-api/media/media-upload-initialize, read
    // 2026-10-01: "type: integer, minimum: 0, maximum: 17179869184".
    // The sandbox capped it at 512 MB, so a 600 MB video was refused.
    const init = (total_bytes: number) =>
      call(
        '/2/media/upload/initialize',
        json({ media_type: 'video/mp4', total_bytes }),
      );

    expect((await init(600 * 1024 * 1024)).status).toBe(200);
    expect((await init(17_179_869_184)).status).toBe(200);
    expect((await init(0)).status).toBe(200);
    expect((await init(17_179_869_185)).status).toBe(400);
    expect((await init(-1)).status).toBe(400);
  });

  it('a post’s non-public metrics carry engagements, as the data dictionary lists them (FILM-1727)', async () => {
    const { id } = await post('Engagements are a non-public member.');
    const result = await call(
      `/2/tweets?ids=${id}&tweet.fields=non_public_metrics`,
    );
    const data = (
      result.body as { data: Array<{ non_public_metrics: object }> }
    ).data[0]!;

    expect(Object.keys(data.non_public_metrics).sort()).toEqual([
      'engagements',
      'impression_count',
      'url_link_clicks',
      'user_profile_clicks',
    ]);
  });
});
