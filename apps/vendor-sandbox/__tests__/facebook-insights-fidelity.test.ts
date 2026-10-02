import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';

/**
 * FILM-1720 against the Meta origin: the app's own Facebook Login config and
 * Facebook video insights provider, run against the sandbox (owner decision,
 * 2026-10-01: built here and shipped dark until App Review grants
 * `read_insights`; live checks are the owner's).
 *
 * Every response names only fields its registry entry declares, and the
 * provider keeps Facebook's denominators apart: no `views`, organic and paid
 * as Meta split them, autoplay and click-to-play likewise.
 */

const APP = 'http://localhost:3132';
const DAY = 86_400_000;
const T0 = Date.parse('2026-09-20T17:00:00Z');
/** A reel the app published before the sandbox ran: adopted on first sight. */
const SEEDED_VIDEO = '1209876543210987';

let now = T0;
let sandbox: Sandbox;

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

/** A Page token from the connect flow, asking for exactly `scopes`. */
async function pageToken(scopes: readonly string[]) {
  const redirectUri = `${APP}/api/platforms/callback/meta`;
  const { META_OAUTH_CONFIG } = await import('@kit/publishing/oauth/meta');

  const dialog = new URL(META_OAUTH_CONFIG.authUrl);
  dialog.search = new URLSearchParams({
    client_id: SANDBOX_CLIENTS.meta.clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(','),
    response_type: 'code',
    state: 'nonce-state',
  }).toString();
  const html = await (await fetch(dialog)).text();
  const action = /action="([^"]+)"/.exec(html)![1]!;
  const hidden = Object.fromEntries(
    [...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(
      ([, k, v]) => [k, v],
    ),
  );
  const form = new URLSearchParams({ ...hidden, decision: 'allow' });
  for (const scope of scopes) form.append('scope', scope);
  const decided = await fetch(`${sandbox.urls.meta}${action}`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const code = new URL(decided.headers.get('location')!).searchParams.get(
    'code',
  )!;

  const user = await graph('/oauth/access_token', {
    client_id: SANDBOX_CLIENTS.meta.clientId,
    client_secret: SANDBOX_CLIENTS.meta.clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const pages = await graph('/me/accounts', {
    access_token: (user.body as { access_token: string }).access_token,
    fields: 'id,name,access_token',
  });
  const [page] = (
    pages.body as { data: { id: string; access_token: string }[] }
  ).data;

  return { id: page!.id, token: page!.access_token };
}

async function provider(token: string) {
  const { createFacebookInsightsProvider } = await import(
    '@kit/content-analytics/providers/facebook'
  );
  return createFacebookInsightsProvider(token);
}

/** The scopes a connect request asks for with the given switch. */
async function requested(enabled: string) {
  const { connectScopes, parseAnalyticsScopesEnabled } = await import(
    '@kit/publishing/oauth/analytics-scope-switch'
  );
  const { META_OAUTH_CONFIG } = await import('@kit/publishing/oauth/meta');
  return connectScopes(
    'meta',
    META_OAUTH_CONFIG.scopes,
    parseAnalyticsScopesEnabled(enabled).enabled,
  );
}

beforeAll(async () => {
  sandbox = await createSandbox({
    seed: 1720,
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

describe('Facebook video insights, dark until the switch is on', () => {
  it('a connection made with the switch off cannot read them', async () => {
    const scopes = await requested('meta');
    expect(scopes).not.toContain('read_insights');

    const page = await pageToken(scopes);
    const { FacebookInsightsScopeError } = await import(
      '@kit/content-analytics/providers/facebook'
    );

    await expect(
      (await provider(page.token)).getVideoInsights({ videoId: SEEDED_VIDEO }),
    ).rejects.toBeInstanceOf(FacebookInsightsScopeError);
  });
});

describe('Facebook video insights, through the app provider', () => {
  it('serves only declared fields on every endpoint the provider calls', async () => {
    now = T0 + 5 * DAY;
    const page = await pageToken(await requested('meta,facebook'));
    const postId = `${page.id}_${SEEDED_VIDEO}`;

    const node = await graph(`/${SEEDED_VIDEO}`, {
      access_token: page.token,
      fields: 'post_id,comments.limit(0).summary(true)',
    });
    expect(node.status).toBe(200);
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{video-id}?fields=post_id'),
        node.body,
      ),
    ).toEqual([]);

    const insights = await graph(`/${SEEDED_VIDEO}/video_insights`, {
      access_token: page.token,
      period: 'lifetime',
      metric: entry('GET', '/{version}/{video-id}/video_insights').reads.join(
        ',',
      ),
    });
    expect(insights.status).toBe(200);
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{video-id}/video_insights'),
        insights.body,
      ),
    ).toEqual([]);

    const post = await graph(`/${postId}`, {
      access_token: page.token,
      fields: 'shares',
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/{post-id}'), post.body),
    ).toEqual([]);

    const postInsights = await graph(`/${postId}/insights`, {
      access_token: page.token,
      period: 'lifetime',
      metric: 'post_media_view,post_total_media_view_unique',
    });
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{post-id}/insights'),
        postInsights.body,
      ),
    ).toEqual([]);
  });

  it('refuses the metrics Graph v25.0 retired, as Meta says it does', async () => {
    const page = await pageToken(await requested('meta,facebook'));

    for (const metric of [
      'total_video_impressions',
      'post_impressions_unique',
    ]) {
      const refused = await graph(`/${SEEDED_VIDEO}/video_insights`, {
        access_token: page.token,
        metric,
      });
      expect(refused.status, metric).toBe(400);
      expect((refused.body as { error: { code: number } }).error.code).toBe(
        100,
      );
    }
  });

  it('keeps every denominator apart, and names no views', async () => {
    now = T0 + 5 * DAY;
    const page = await pageToken(await requested('meta,facebook'));
    const result = await (
      await provider(page.token)
    ).getVideoInsights({
      videoId: SEEDED_VIDEO,
    });
    const t = result.totals;

    expect(result.postId).toBe(`${page.id}_${SEEDED_VIDEO}`);
    expect(t).not.toHaveProperty('views');
    for (const [name, value] of Object.entries(t)) {
      expect(value, name).not.toBeNull();
    }

    // Meta's splits, kept: each pair adds up to the 3-second total.
    expect(t.threeSecondViewsOrganic! + t.threeSecondViewsPaid!).toBe(
      t.threeSecondViews,
    );
    expect(
      t.threeSecondViewsAutoplayed! + t.threeSecondViewsClickedToPlay!,
    ).toBe(t.threeSecondViews);
    // A first play comes before a 3-second view, which comes before a
    // 15-second or a complete one; a display before a play.
    expect(t.firstPlays!).toBeGreaterThanOrEqual(t.threeSecondViews!);
    expect(t.threeSecondViews!).toBeGreaterThanOrEqual(t.fifteenSecondViews!);
    expect(t.threeSecondViews!).toBeGreaterThanOrEqual(t.completeViews!);
    expect(t.mediaViews!).toBeGreaterThan(t.firstPlays!);
    expect(t.uniqueViewers!).toBeLessThanOrEqual(t.mediaViews!);

    // 41 points, 0 to 1 of the way through, falling from everyone.
    expect(result.retention).toHaveLength(41);
    expect(result.retention![0]).toEqual({ elapsedRatio: 0, watchRatio: 1 });
    expect(result.retention!.at(-1)!.elapsedRatio).toBe(1);
    const ratios = result.retention!.map((point) => point.watchRatio);
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
  });

  it('only ever grows: a later read is at least an earlier one', async () => {
    const page = await pageToken(await requested('meta,facebook'));
    const read = async (at: number) => {
      now = at;
      return (await provider(page.token)).getVideoInsights({
        videoId: SEEDED_VIDEO,
      });
    };

    const earlier = (await read(T0 + 6 * DAY)).totals;
    const later = (await read(T0 + 9 * DAY)).totals;

    for (const name of Object.keys(earlier) as (keyof typeof earlier)[]) {
      expect(later[name]!, name).toBeGreaterThanOrEqual(earlier[name]!);
    }
  });
});

describe("a Page's other figures (FILM-1720)", () => {
  it("splits a video's 3-second views by age and gender, and by country", async () => {
    now = T0 + 5 * DAY;
    const page = await pageToken(await requested('meta,facebook'));
    const result = await (
      await provider(page.token)
    ).getVideoInsights({ videoId: SEEDED_VIDEO });
    const audience = result.audience!;
    const total = (rows: { views: number }[]) =>
      rows.reduce((sum, row) => sum + row.views, 0);

    expect(audience.ageGender.length).toBeGreaterThan(0);
    expect(audience.countries.length).toBeGreaterThan(0);
    // Each breakdown is a share of the same 3-second views, nothing more.
    expect(total(audience.ageGender)).toBe(result.totals.threeSecondViews);
    expect(total(audience.countries)).toBe(result.totals.threeSecondViews);
    for (const row of audience.ageGender) {
      expect(['F', 'M', 'U']).toContain(row.gender);
      expect(row.ageGroup).toMatch(/^\d{2}(-\d{2}|\+)$/);
    }
  });

  it("reads the Page's followers and unique viewers, from declared fields", async () => {
    now = T0 + 5 * DAY;
    const page = await pageToken(await requested('meta,facebook'));
    const facebook = await provider(page.token);

    const node = await graph(`/${page.id}`, {
      access_token: page.token,
      fields: 'followers_count',
    });
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{page-id}?fields=followers_count'),
        node.body,
      ),
    ).toEqual([]);

    const insights = await graph(`/${page.id}/insights`, {
      access_token: page.token,
      metric: 'page_total_media_view_unique',
      period: 'week',
      since: String(Math.floor((now - 7 * DAY) / 1000)),
      until: String(Math.floor(now / 1000)),
    });
    expect(insights.status).toBe(200);
    expect(
      undeclaredKeys(
        entry('GET', '/{version}/{page-id}/insights'),
        insights.body,
      ),
    ).toEqual([]);

    const followers = await facebook.getPageFollowerCount(page.id);
    expect(followers.ok).toBe(true);

    const asOf = new Date(T0 + 4 * DAY).toISOString().slice(0, 10);
    const viewers = Object.fromEntries(
      (await facebook.getPageUniqueViewers(page.id, asOf)).map((w) => [
        w.windowDays,
        w.viewers,
      ]),
    );
    // Unique people over a longer window are never fewer than a shorter one.
    expect(viewers[1]).not.toBeNull();
    expect(viewers[7]!).toBeGreaterThanOrEqual(viewers[1]!);
    expect(viewers[28]!).toBeGreaterThanOrEqual(viewers[7]!);
  });

  it('a connection made with the switch off cannot read Page insights', async () => {
    const page = await pageToken(await requested('meta'));
    const { FacebookInsightsScopeError } = await import(
      '@kit/content-analytics/providers/facebook'
    );
    const asOf = new Date(T0 + 4 * DAY).toISOString().slice(0, 10);

    await expect(
      (await provider(page.token)).getPageUniqueViewers(page.id, asOf),
    ).rejects.toBeInstanceOf(FacebookInsightsScopeError);
  });
});
