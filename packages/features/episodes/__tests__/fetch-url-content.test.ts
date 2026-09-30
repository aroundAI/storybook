import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchUrlContentAction } from '../src/server/source-upload-actions';

/**
 * FILM-1141. Fetching a URL for the research hub: the page's text comes back
 * without its markup, scripts or styles, and a URL that could reach inside the
 * network is refused before anything is requested. Only the network is
 * stubbed (DNS and `fetch`); the extraction is the real code.
 */

const dns = vi.hoisted(() => ({ ips: ['93.184.216.34'] as string[] | Error }));

vi.mock('node:dns/promises', () => ({
  resolve4: async () => {
    if (dns.ips instanceof Error) throw dns.ips;

    return dns.ips;
  },
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));
vi.mock('@kit/next/refusals', () => ({ returnRefusals: (fn: unknown) => fn }));
vi.mock('@kit/next/action-result', () => ({ ActionRefusal: Error }));
vi.mock('@kit/prompt-engine/llm-job-target', () => ({
  authorizeProjectTarget: vi.fn(),
}));
vi.mock('@kit/supabase/require-user', () => ({ requireUser: vi.fn() }));
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(),
}));
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  dns.ips = ['93.184.216.34'];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const page = (
  body: string,
  init: { status?: number; contentType?: string } = {},
) =>
  new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
  });

describe('fetchUrlContentAction: extracting text', () => {
  it('returns a page’s text without its tags, scripts and styles', async () => {
    fetchMock.mockResolvedValue(
      page(`<html><head><style>p { color: red }</style>
        <script>alert('x')</script></head>
        <body><h1>Tide tables</h1><p>High   tide at <b>06:12</b>.</p></body></html>`),
    );

    const result = await fetchUrlContentAction({
      url: 'https://example.com/tides',
    });

    expect(result.content).toBe('Tide tables High tide at 06:12 .');
    expect(result.content).not.toMatch(/alert|color|<|>/);
    expect(result.title).toBe('https://example.com/tides');
    expect(result.contentType).toBe('text/html; charset=utf-8');
  });

  it('leaves plain text as it is', async () => {
    fetchMock.mockResolvedValue(
      page('One line.\n\nSecond <not a tag> line.', {
        contentType: 'text/plain',
      }),
    );

    const result = await fetchUrlContentAction({
      url: 'https://example.com/notes.txt',
    });

    expect(result.content).toBe('One line.\n\nSecond <not a tag> line.');
  });

  it('cuts a long page to 50,000 characters and says how long it was', async () => {
    fetchMock.mockResolvedValue(
      page('x'.repeat(60_000), { contentType: 'text/plain' }),
    );

    const result = await fetchUrlContentAction({
      url: 'https://example.com/long',
    });

    expect(result.content).toHaveLength(50_003);
    expect(result.content.endsWith('...')).toBe(true);
    expect(result.length).toBe(60_000);
  });

  it('identifies itself and does not follow redirects', async () => {
    fetchMock.mockResolvedValue(page('ok'));

    await fetchUrlContentAction({ url: 'https://example.com/' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({
        redirect: 'manual',
        headers: { 'User-Agent': 'StoryBook-Research/1.0' },
      }),
    );
  });
});

describe('fetchUrlContentAction: what it refuses', () => {
  it.each([
    ['localhost', 'http://localhost:3000/admin'],
    ['0.0.0.0', 'http://0.0.0.0/'],
  ])('refuses %s before any lookup', async (_, url) => {
    await expect(fetchUrlContentAction({ url })).rejects.toThrow(
      'URL points to a private or internal address',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '172.16.4.2',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '0.1.2.3',
  ])('refuses a name that resolves to %s, and requests nothing', async (ip) => {
    dns.ips = [ip];

    await expect(
      fetchUrlContentAction({ url: 'https://internal.example.com/' }),
    ).rejects.toThrow('URL resolves to a private or internal address');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows the addresses just outside the private ranges', async () => {
    fetchMock.mockImplementation(async () => page('ok'));

    for (const ip of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1']) {
      dns.ips = [ip];

      await expect(
        fetchUrlContentAction({ url: 'https://example.com/' }),
      ).resolves.toMatchObject({ content: 'ok' });
    }
  });

  it('refuses a name with any private address among its answers', async () => {
    dns.ips = ['93.184.216.34', '10.0.0.5'];

    await expect(
      fetchUrlContentAction({ url: 'https://example.com/' }),
    ).rejects.toThrow('URL resolves to a private or internal address');
  });

  it('refuses a name that does not resolve', async () => {
    dns.ips = new Error('ENOTFOUND');

    await expect(
      fetchUrlContentAction({ url: 'https://nowhere.example/' }),
    ).rejects.toThrow('Unable to resolve hostname: nowhere.example');
  });

  it('refuses a redirect, which could lead inside', async () => {
    fetchMock.mockResolvedValue(page('', { status: 302 }));

    await expect(
      fetchUrlContentAction({ url: 'https://example.com/go' }),
    ).rejects.toThrow('URL returned a redirect, which is not allowed');
  });

  it('reports a failed fetch with its status', async () => {
    fetchMock.mockResolvedValue(page('nope', { status: 404 }));

    await expect(
      fetchUrlContentAction({ url: 'https://example.com/missing' }),
    ).rejects.toThrow('Failed to fetch URL: 404');
  });

  it('refuses text that is not a URL, and fetches nothing', async () => {
    expect(() => fetchUrlContentAction({ url: 'not a url' })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
