import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';
import {
  SERVED,
  type ServedEndpoint,
  undeclaredKeys,
} from '../src/social/fields';
import { PROCESSING_MS } from '../src/social/vendors/meta/publishing';

/**
 * FILM-1802 for the Meta origin, the publishing side: the app's own
 * Instagram and Facebook providers publish a Reel through the sandbox, and
 * the next analytics read reports on the new post. Every response names
 * only fields its registry entry declares.
 */

const APP = 'http://localhost:3132';
/**
 * Four times real time: the provider's 5 s poll is 20 simulated seconds, so a
 * container finishes after one poll, and a request made at once is early.
 */
const T0 = Date.parse('2026-09-28T17:00:00Z');
const START = Date.now();
const tick = () => T0 + (Date.now() - START) * 4;

let sandbox: Sandbox;
let pageToken: string;
let pageId: string;
let igId: string;

function entry(method: string, path: string): ServedEndpoint {
  const found = SERVED.find(
    (e) => e.origin === 'meta' && e.method === method && e.path === path,
  );
  if (!found) throw new Error(`no registry entry for ${method} ${path}`);
  return found;
}

async function graph(
  path: string,
  params: Record<string, string>,
  init: RequestInit = {},
) {
  const { META_GRAPH_BASE } = await import('@kit/shared/vendors');
  const response = await fetch(
    `${META_GRAPH_BASE}${path}?${new URLSearchParams(params)}`,
    init,
  );
  return { status: response.status, body: (await response.json()) as never };
}

beforeAll(async () => {
  sandbox = await createSandbox({
    seed: 1803,
    speed: 1,
    now: tick,
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

  // A connected account, the way the callback leaves it: a Page token.
  const { META_OAUTH_CONFIG } = await import('@kit/publishing/oauth/meta');
  const dialog = new URL(META_OAUTH_CONFIG.authUrl);
  dialog.search = new URLSearchParams({
    client_id: SANDBOX_CLIENTS.meta.clientId,
    redirect_uri: `${APP}/api/platforms/callback/meta`,
    scope: META_OAUTH_CONFIG.scopes.join(','),
    response_type: 'code',
  }).toString();
  const html = await (await fetch(dialog)).text();
  const action = /action="([^"]+)"/.exec(html)![1]!;
  const hidden = Object.fromEntries(
    [...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(
      ([, k, v]) => [k, v],
    ),
  );
  const form = new URLSearchParams({ ...hidden, decision: 'allow' });
  for (const scope of META_OAUTH_CONFIG.scopes) form.append('scope', scope);
  const back = new URL(
    (
      await fetch(`${sandbox.urls.meta}${action}`, {
        method: 'POST',
        body: form,
        redirect: 'manual',
      })
    ).headers.get('location')!,
  );
  const short = await graph('/oauth/access_token', {
    client_id: SANDBOX_CLIENTS.meta.clientId,
    client_secret: SANDBOX_CLIENTS.meta.clientSecret,
    redirect_uri: `${APP}/api/platforms/callback/meta`,
    code: back.searchParams.get('code')!,
  });
  const pages = await graph('/me/accounts', {
    access_token: (short.body as { access_token: string }).access_token,
    fields: 'id,access_token,instagram_business_account',
  });
  const [page] = (
    pages.body as {
      data: Array<{
        id: string;
        access_token: string;
        instagram_business_account: { id: string };
      }>;
    }
  ).data;
  pageToken = page!.access_token;
  pageId = page!.id;
  igId = page!.instagram_business_account.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('Meta sandbox: publishing a Reel through the app providers', () => {
  it('Instagram: container → IN_PROGRESS → FINISHED → published → permalink', async () => {
    const container = await graph(
      `/${igId}/media`,
      {
        media_type: 'REELS',
        video_url: 'https://cdn.example.org/harbour.mp4',
        caption: 'The harbour at dusk',
        access_token: pageToken,
      },
      { method: 'POST' },
    );
    expect(
      undeclaredKeys(
        entry('POST', '/{version}/{ig-user-id}/media'),
        container.body,
      ),
    ).toEqual([]);
    const containerId = (container.body as { id: string }).id;

    const first = await graph(`/${containerId}`, {
      fields: 'status_code,status',
      access_token: pageToken,
    });
    expect((first.body as { status_code: string }).status_code).toBe(
      'IN_PROGRESS',
    );
    expect(
      undeclaredKeys(entry('GET', '/{version}/{ig-container-id}'), first.body),
    ).toEqual([]);

    // Publishing before it is ready is refused, as Meta refuses it.
    const early = await graph(
      `/${igId}/media_publish`,
      {},
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: pageToken,
        }),
      },
    );
    expect(early.status).toBe(400);
    expect(PROCESSING_MS).toBeGreaterThan(0);
  });

  it("the app's InstagramProvider publishes end to end, and the post reports views", async () => {
    const { InstagramProvider } = await import(
      '@kit/publishing/providers/instagram'
    );
    const result = await new InstagramProvider(pageToken, igId).uploadReel({
      videoUrl: 'https://cdn.example.org/lighthouse.mp4',
      caption: 'Lighthouse, second night',
      shareToFeed: true,
    });

    // The provider reports FINISHED once it has published and read the
    // permalink; the container itself is PUBLISHED.
    expect(result.status).toBe('FINISHED');
    expect(result.mediaId).toMatch(/^\d+$/);
    expect(result.permalink).toMatch(
      /^https:\/\/www\.instagram\.com\/reel\/[\w-]{11}\/$/,
    );

    const node = await graph(`/${result.mediaId}`, {
      fields: 'permalink',
      access_token: pageToken,
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/{ig-media-id}'), node.body),
    ).toEqual([]);

    // The next analytics read knows the new post.
    const insights = await graph(`/${result.mediaId}/insights`, {
      metric: 'views,reach',
      access_token: pageToken,
    });
    expect(insights.status).toBe(200);
  });

  it('FILM-1731: a container declared AI-generated publishes a post kept as such; an undeclared one is not, and a non-boolean is refused', async () => {
    const { InstagramProvider } = await import(
      '@kit/publishing/providers/instagram'
    );
    const declared = await new InstagramProvider(pageToken, igId).uploadReel({
      videoUrl: 'https://cdn.example.org/harbour-ai.mp4',
      caption: 'The harbour, declared AI-generated',
      shareToFeed: true,
      aiGenerated: true,
    });
    expect(declared.status).toBe('FINISHED');
    expect(
      sandbox.social.object('instagram', declared.mediaId).details,
    ).toMatchObject({ isAiGenerated: true });

    // A container created without the parameter is kept as undeclared.
    const plain = await graph(
      `/${igId}/media`,
      {
        media_type: 'REELS',
        video_url: 'https://cdn.example.org/harbour-plain.mp4',
        access_token: pageToken,
      },
      { method: 'POST' },
    );
    const containers = sandbox.social.list<{
      id: string;
      aiGenerated?: boolean;
    }>('ig-container');
    expect(
      containers.find((c) => c.id === (plain.body as { id: string }).id),
    ).not.toHaveProperty('aiGenerated');
    expect(containers.find((c) => c.id === declared.containerId)).toMatchObject(
      { aiGenerated: true },
    );

    const refused = await graph(
      `/${igId}/media`,
      {
        media_type: 'REELS',
        video_url: 'https://cdn.example.org/harbour.mp4',
        is_ai_generated: 'yes',
        access_token: pageToken,
      },
      { method: 'POST' },
    );
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: 100 } });
  });

  it("the app's FacebookProvider publishes a Reel: start → upload → finish → status", async () => {
    const { FacebookProvider } = await import(
      '@kit/publishing/providers/facebook'
    );
    const provider = new FacebookProvider(pageToken, pageId);
    const uploaded = await provider.uploadVideo({
      videoPath: 'https://cdn.example.org/harbour.mp4',
      title: 'Harbour',
      description: 'The harbour at dusk',
      isReel: true,
      published: true,
    } as never);
    expect(uploaded.videoId).toMatch(/^\d+$/);

    const status = await graph(`/${uploaded.videoId}`, {
      fields: 'status',
      access_token: pageToken,
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/{video-id}'), status.body),
    ).toEqual([]);
    expect(['uploading', 'processing', 'ready']).toContain(
      (status.body as { status: { video_status: string } }).status.video_status,
    );
  });

  // Observed on the owner's Page (2026-09-29): permalink_url is a path, and
  // DELETE answers { success: true }. The provider makes the path a link.
  it("the app's FacebookProvider reads a relative permalink as a link, then deletes the Reel", async () => {
    const { FacebookProvider } = await import(
      '@kit/publishing/providers/facebook'
    );
    const provider = new FacebookProvider(pageToken, pageId);
    const { videoId } = await provider.uploadVideo({
      videoPath: 'https://cdn.example.org/pier.mp4',
      title: 'Pier',
      description: 'The pier at noon',
      isReel: true,
      published: true,
    } as never);

    const raw = await graph(`/${videoId}`, {
      fields: 'status,permalink_url',
      access_token: pageToken,
    });
    expect(
      undeclaredKeys(entry('GET', '/{version}/{video-id}'), raw.body),
    ).toEqual([]);
    expect((raw.body as { permalink_url: string }).permalink_url).toBe(
      `/reel/${videoId}/`,
    );
    expect((await provider.getVideoStatus(videoId)).videoUrl).toBe(
      `https://www.facebook.com/reel/${videoId}/`,
    );

    await provider.deleteVideo(videoId);
    const gone = await graph(`/${videoId}`, {
      fields: 'status',
      access_token: pageToken,
    });
    expect(gone.status).toBe(400);
    expect((gone.body as { error: { code: number } }).error.code).toBe(100);
    await expect(provider.deleteVideo(videoId)).rejects.toThrow(
      /delete failed/,
    );
  });

  it('publishing without instagram_content_publish is refused with code 10', async () => {
    const { access } = sandbox.social.issueTokens(
      'facebook',
      pageId,
      ['pages_show_list'],
      {
        refresh: false,
      },
    );
    const refused = await graph(
      `/${igId}/media`,
      {
        media_type: 'REELS',
        video_url: 'https://cdn.example.org/x.mp4',
        access_token: access.value,
      },
      { method: 'POST' },
    );
    expect((refused.body as { error: { code: number } }).error.code).toBe(10);
  });
});
