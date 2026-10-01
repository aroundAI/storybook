import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1728 §7.3.A. Every Meta Graph call goes through `metaFetch`, which
 * reads the `facebook-api-version` header Meta answers with and says so,
 * once, when it is not the pinned version.
 *
 * The v18.0 → v20.0 substitution FILM-1723 found ran for eight months because
 * nothing read that header. Meta does not fail a call to an expired version;
 * it serves the next oldest one (measured 2026-10-01: a request for the
 * unreleased v27.0 was answered as v21.0).
 */

function answer(headers: Record<string, string> = {}, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

let sent: Array<{ url: string; init: RequestInit }>;
let errors: string[];

async function load() {
  vi.resetModules();
  return import('../src/vendors');
}

beforeEach(() => {
  sent = [];
  errors = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url: String(url), init });
      return nextAnswer();
    }),
  );
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let nextAnswer = () => answer();

/** Five versions behind whatever the pin is: what an expired pin is served. */
async function staleVersion() {
  const { META_GRAPH_VERSION } = await import('../src/vendors');
  return `v${Number(META_GRAPH_VERSION.slice(1, -2)) - 5}.0`;
}

describe('metaFetch (FILM-1728)', () => {
  it('reports a served version that is not the pin: vendor, expected, served, endpoint', async () => {
    const { META_GRAPH_VERSION, metaFetch } = await load();
    const stale = await staleVersion();
    nextAnswer = () =>
      answer({
        'facebook-api-version': stale,
        'x-app-usage': '{"call_count":4,"total_cputime":1,"total_time":2}',
      });

    await metaFetch('/me/accounts?fields=id,name', { token: 'page-token' });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('vendor=meta');
    expect(errors[0]).toContain(`expected=${META_GRAPH_VERSION}`);
    expect(errors[0]).toContain(`served=${stale}`);
    expect(errors[0]).toContain('endpoint=GET /me/accounts');
    expect(errors[0]).toContain('"call_count":4');
    // The query string can carry secrets; the line never does.
    expect(errors[0]).not.toContain('fields=');
  });

  it('reports a mismatch once per process, not once per call', async () => {
    const { metaFetch } = await load();
    const stale = await staleVersion();
    nextAnswer = () => answer({ 'facebook-api-version': stale });

    await metaFetch('/me', { token: 't' });
    await metaFetch('/me/accounts', { token: 't' });
    await metaFetch('/123/videos', { token: 't', method: 'POST' });

    expect(errors).toHaveLength(1);
  });

  it('says nothing when Meta serves the pinned version', async () => {
    const { META_GRAPH_VERSION, metaFetch } = await load();
    nextAnswer = () => answer({ 'facebook-api-version': META_GRAPH_VERSION });

    await metaFetch('/me', { token: 't' });

    expect(errors).toEqual([]);
  });

  it('sends the token as Authorization: Bearer, never in the URL', async () => {
    const { META_GRAPH_BASE, metaFetch } = await load();
    nextAnswer = () => answer();

    await metaFetch('/17841400000000000?fields=followers_count', {
      token: 'secret-page-token',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(
      `${META_GRAPH_BASE}/17841400000000000?fields=followers_count`,
    );
    expect(sent[0]!.url).not.toContain('secret-page-token');
    expect(new Headers(sent[0]!.init.headers).get('authorization')).toBe(
      'Bearer secret-page-token',
    );
  });

  it('puts non-resumable video uploads on the graph-video host', async () => {
    const { META_GRAPH_VIDEO_BASE, metaFetch } = await load();
    nextAnswer = () => answer();

    await metaFetch('/42/videos', {
      token: 't',
      method: 'POST',
      host: 'video',
    });

    expect(sent[0]!.url).toBe(`${META_GRAPH_VIDEO_BASE}/42/videos`);
  });

  it('refuses anything but a path below the pinned version', async () => {
    const { metaFetch } = await load();

    await expect(
      metaFetch('https://example.com/me', { token: 't' }),
    ).rejects.toThrow(/path/);
    expect(sent).toEqual([]);
  });
});
