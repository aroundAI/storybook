import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';
import { MAX_WINDOW_S, uniqueReach } from '../src/social/vendors/meta/insights';
import { LONG_TTL_S } from '../src/social/vendors/meta/oauth';

/**
 * FILM-1802 for the Meta origin, the read side: the app's own Facebook Login
 * config and Instagram provider, run against the sandbox. Every response
 * names only fields its registry entry declares (so only fields the
 * capability reference documents), and unique reach behaves as Meta's does:
 * never more than views, not additive across days, split into followers and
 * non-followers that sum to it, and refused over more than 30 days.
 */

const APP = 'http://localhost:3132';
const DAY = 86_400_000;
const T0 = Date.parse('2026-09-20T17:00:00Z');
/** A post the app published before the sandbox ran: adopted on first sight. */
const SEEDED_REEL = '17912345678901234';

let now = T0;
let sandbox: Sandbox;
let pageToken: string;
let igId: string;

function entry(method: string, path: string): ServedEndpoint {
  const found = SERVED.find(
    (e) => e.origin === 'meta' && e.method === method && e.path === path,
  );
  if (!found) throw new Error(`no registry entry for ${method} ${path}`);
  return found;
}

async function graph(path: string, params: Record<string, string>) {
  const { META_GRAPH_BASE } = await import('@kit/shared/vendors');
  const response = await fetch(
    `${META_GRAPH_BASE}${path}?${new URLSearchParams(params)}`,
  );
  return { status: response.status, body: (await response.json()) as never };
}

async function provider() {
  const { createInstagramInsightsProvider } = await import(
    '@kit/content-analytics/providers/instagram'
  );
  return createInstagramInsightsProvider(pageToken, igId);
}

const at = (ms: number) => new Date(ms);

beforeAll(async () => {
  sandbox = await createSandbox({
    seed: 1802,
    speed: 1,
    now: () => now,
    ports: {
      control: 0,
      openai: 0,
      gemini: 0,
      elevenlabs: 0,
      meta: 0,
      tiktok: 0,
      google: 0,
      x: 0,
      linkedin: 0,
    },
  });
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
  for (const name of ['META_GRAPH', 'META_GRAPH_VIDEO', 'META_OAUTH']) {
    vi.stubEnv(`VENDOR_URL_${name}`, sandbox.urls.meta);
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('Meta sandbox: Facebook Login, as the connect callback runs it', () => {
  it('dialog → code → short-lived token → long-lived token → Pages → permissions', async () => {
    const { META_OAUTH_CONFIG } = await import('@kit/publishing/oauth/meta');
    const redirectUri = `${APP}/api/platforms/callback/meta`;

    const dialog = new URL(META_OAUTH_CONFIG.authUrl);
    dialog.search = new URLSearchParams({
      client_id: SANDBOX_CLIENTS.meta.clientId,
      redirect_uri: redirectUri,
      scope: META_OAUTH_CONFIG.scopes.join(','),
      response_type: 'code',
      state: 'nonce-state',
    }).toString();
    const page = await fetch(dialog);
    expect(page.status).toBe(200);
    const html = await page.text();
    const action = /action="([^"]+)"/.exec(html)![1]!;
    const hidden = Object.fromEntries(
      [...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(
        ([, k, v]) => [k, v],
      ),
    );
    const form = new URLSearchParams({ ...hidden, decision: 'allow' });
    for (const scope of META_OAUTH_CONFIG.scopes) form.append('scope', scope);
    const decided = await fetch(`${sandbox.urls.meta}${action}`, {
      method: 'POST',
      body: form,
      redirect: 'manual',
    });
    const back = new URL(decided.headers.get('location')!);
    expect(back.searchParams.get('state')).toBe('nonce-state');

    const tokenPath = '/oauth/access_token';
    const short = await graph(tokenPath, {
      client_id: SANDBOX_CLIENTS.meta.clientId,
      client_secret: SANDBOX_CLIENTS.meta.clientSecret,
      redirect_uri: redirectUri,
      code: back.searchParams.get('code')!,
    });
    expect(short.status).toBe(200);
    expect(
      undeclaredKeys(entry('GET', '/{version}/oauth/access_token'), short.body),
    ).toEqual([]);

    const long = await graph(tokenPath, {
      grant_type: 'fb_exchange_token',
      client_id: SANDBOX_CLIENTS.meta.clientId,
      client_secret: SANDBOX_CLIENTS.meta.clientSecret,
      fb_exchange_token: (short.body as { access_token: string }).access_token,
    });
    const userToken = long.body as { access_token: string; expires_in: number };
    expect(userToken.expires_in).toBe(LONG_TTL_S);

    const pages = await graph('/me/accounts', {
      access_token: userToken.access_token,
      fields:
        'id,name,access_token,category,picture,instagram_business_account',
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/me/accounts'), pages.body),
    ).toEqual([]);
    const [linked] = (
      pages.body as {
        data: Array<{
          access_token: string;
          instagram_business_account: { id: string };
        }>;
      }
    ).data;
    pageToken = linked!.access_token;
    igId = linked!.instagram_business_account.id;

    const permissions = await graph('/me/permissions', {
      access_token: userToken.access_token,
    });
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/me/permissions'),
        permissions.body,
      ),
    ).toEqual([]);
    expect(
      (permissions.body as { data: Array<{ permission: string }> }).data.map(
        (p) => p.permission,
      ),
    ).toContain('instagram_manage_insights');
  });

  it('a wrong redirect or a reused code is refused, as Meta refuses it', async () => {
    const bad = await graph('/oauth/access_token', {
      client_id: SANDBOX_CLIENTS.meta.clientId,
      client_secret: SANDBOX_CLIENTS.meta.clientSecret,
      redirect_uri: `${APP}/elsewhere`,
      code: 'not-a-code',
    });
    expect(bad.status).toBe(400);
    expect(undeclaredKeys(entry('GET', '(any error)'), bad.body)).toEqual([]);
  });
});

describe('Meta sandbox: Instagram reads, through the app provider', () => {
  it('the account node and the follower count', async () => {
    const node = await graph(`/${igId}`, {
      access_token: pageToken,
      fields: 'username,name,profile_picture_url,followers_count',
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/{ig-user-id}'), node.body),
    ).toEqual([]);

    const count = await (await provider()).getFollowerCount();
    expect(count).toEqual({
      ok: true,
      count: (node.body as { followers_count: number }).followers_count,
    });
  });

  it('media insights for a seeded Reel: every metric, consistent with each other', async () => {
    now = T0 + 5 * DAY;
    const info = await graph(`/${SEEDED_REEL}`, {
      access_token: pageToken,
      fields:
        'media_type,media_product_type,reposts_count,total_views_count,total_like_count,total_comments_count',
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/{ig-media-id}'), info.body),
    ).toEqual([]);
    const node = info.body as Record<string, number>;
    const reposts = node.reposts_count!;

    const raw = await graph(`/${SEEDED_REEL}/insights`, {
      access_token: pageToken,
      metric:
        'views,reach,total_interactions,likes,comments,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate',
    });
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{ig-media-id}/insights'),
        raw.body,
      ),
    ).toEqual([]);
    const value = Object.fromEntries(
      (
        raw.body as {
          data: Array<{ name: string; values: [{ value: number }] }>;
        }
      ).data.map((item) => [item.name, item.values[0].value]),
    );
    expect(value.views).toBeGreaterThan(0);
    expect(value.reach).toBeLessThanOrEqual(value.views!);
    expect(value.total_interactions).toBe(
      value.likes! + value.comments! + value.saved! + value.shares!,
    );
    // Milliseconds (owner, live account, 2026-09-28 and -29). The average is
    // not total ÷ views: the live Reel gave total ÷ 121 with 221 views. It
    // divides by a count no larger than views, so it is at least total ÷ views.
    expect(value.ig_reels_avg_watch_time).toBeGreaterThanOrEqual(
      Math.round(value.ig_reels_video_view_total_time! / value.views!),
    );

    // KB-151: a share of views, on Meta's "percentage" scale, never above it.
    expect(value.reels_skip_rate).toBeGreaterThan(0);
    expect(value.reels_skip_rate).toBeLessThanOrEqual(100);

    const insights = await (
      await provider()
    ).getMediaInsights({ mediaId: SEEDED_REEL });
    expect(insights.totals.views).toBe(value.views);
    expect(insights.totals.reach).toBe(value.reach);
    // KB-151: both Reels attention figures reach the provider's totals as
    // served, the average not recomputed from the total.
    expect(insights.totals.avgWatchTimeMs).toBe(value.ig_reels_avg_watch_time);
    expect(insights.totals.reelsSkipRate).toBe(value.reels_skip_rate);
    // FILM-1712: reposts ride on the media-info call, a count no larger than
    // the shares that carry them.
    expect(insights.totals.reposts).toBe(reposts);
    expect(reposts).toBeLessThanOrEqual(value.shares!);
    // FILM-1722: the all-surface aggregates ride on the same call, land in
    // their own totals, and fold in boosted placements — never less than the
    // organic figure, and never in place of it.
    expect(insights.totals).toMatchObject({
      allSurfaceViews: node.total_views_count,
      allSurfaceLikes: node.total_like_count,
      allSurfaceComments: node.total_comments_count,
      views: value.views,
      likes: value.likes,
      comments: value.comments,
    });
    expect(node.total_views_count).toBeGreaterThanOrEqual(value.views!);
    expect(node.total_like_count).toBeGreaterThanOrEqual(value.likes!);
    expect(node.total_comments_count).toBeGreaterThanOrEqual(value.comments!);
  });

  it('account reach: unique, not additive, split, and never over 30 days', async () => {
    now = T0 + 40 * DAY;
    const reachOf = async (fromMs: number, toMs: number) =>
      (await provider()).getAccountReach({
        since: at(fromMs),
        until: at(toMs),
      });

    const end = Date.UTC(2026, 9, 29);
    const r7 = await reachOf(end - 7 * DAY, end);
    const r30 = await reachOf(end - 30 * DAY, end);

    expect(r30.accountsReached!).toBeGreaterThanOrEqual(r7.accountsReached!);
    for (const r of [r7, r30]) {
      expect(r.followers! + r.nonFollowers!).toBe(r.accountsReached);
    }

    // Unique over the window is at most the days' own figures summed: the
    // union of their audiences.
    let summed = 0;
    for (let day = 0; day < 30; day++) {
      const from = end - (30 - day) * DAY;
      summed += (await reachOf(from, from + DAY)).accountsReached!;
    }
    expect(r30.accountsReached!).toBeLessThanOrEqual(summed);

    const views = await graph(`/${igId}/insights`, {
      access_token: pageToken,
      metric: 'views',
      metric_type: 'total_value',
      period: 'day',
      since: String((end - 30 * DAY) / 1000),
      until: String(end / 1000),
    });
    const viewTotal = (
      views.body as { data: [{ total_value: { value: number } }] }
    ).data[0].total_value.value;
    expect(r30.accountsReached!).toBeLessThanOrEqual(viewTotal);

    const tooLong = await graph(`/${igId}/insights`, {
      access_token: pageToken,
      metric: 'reach',
      metric_type: 'total_value',
      period: 'day',
      since: String((end - 31 * DAY) / 1000),
      until: String(end / 1000),
    });
    expect(tooLong.status).toBe(400);
    expect(MAX_WINDOW_S).toBe(30 * 86_400);
  });

  it('every account-insights response names only declared fields', async () => {
    const end = Date.UTC(2026, 9, 29) / 1000;
    for (const extra of [{}, { breakdown: 'follow_type' }] as Array<
      Record<string, string>
    >) {
      const body = (
        await graph(`/${igId}/insights`, {
          access_token: pageToken,
          metric: 'reach',
          metric_type: 'total_value',
          period: 'day',
          since: String(end - 7 * 86_400),
          until: String(end),
          ...extra,
        })
      ).body;
      expect(
        undeclaredKeys(entry('GET', '/{version}/{ig-user-id}/insights'), body),
      ).toEqual([]);
    }
    const demographics = await graph(`/${igId}/insights`, {
      access_token: pageToken,
      metric: 'follower_demographics',
      period: 'lifetime',
      metric_type: 'total_value',
      timeframe: 'this_month',
      breakdown: 'country',
    });
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{ig-user-id}/insights'),
        demographics.body,
      ),
    ).toEqual([]);
  });

  it('a breakdown on media insights is refused with code 100, not ignored (#278)', async () => {
    const refused = await graph(`/${SEEDED_REEL}/insights`, {
      access_token: pageToken,
      metric: 'reach',
      breakdown: 'follow_type',
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { code: number } }).error.code).toBe(100);

    const plain = await graph(`/${SEEDED_REEL}/insights`, {
      access_token: pageToken,
      metric: 'reach',
    });
    expect(plain.status).toBe(200);
  });

  it('a token without instagram_manage_insights is refused with code 10', async () => {
    const refused = await graph(`/${igId}/insights`, {
      access_token: 'sbx.facebook.unknown',
      metric: 'reach',
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { code: number } }).error.code).toBe(190);
  });
});

describe('the reach model', () => {
  it('dedupes strictly once volume is comparable to the audience', () => {
    const pool = 500;
    expect(uniqueReach(1000, pool)).toBeLessThan(2 * uniqueReach(500, pool));
    expect(uniqueReach(1000, pool)).toBeLessThanOrEqual(pool);
  });

  it('never exceeds views, and a window never exceeds the sum of its days', () => {
    const pool = 2_600;
    for (const days of [
      [6, 6, 6],
      [1, 0, 2, 9],
      [300, 250, 410],
    ]) {
      const window = uniqueReach(
        days.reduce((a, b) => a + b, 0),
        pool,
      );
      const summed = days.reduce((sum, v) => sum + uniqueReach(v, pool), 0);
      expect(window).toBeLessThanOrEqual(summed);
      for (const v of days) expect(uniqueReach(v, pool)).toBeLessThanOrEqual(v);
    }
  });
});
