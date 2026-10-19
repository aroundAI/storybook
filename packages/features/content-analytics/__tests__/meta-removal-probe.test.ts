import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-207. Meta's code 100 / subcode 33 means "does not exist" and also
 * "cannot be loaded due to missing permissions". A Facebook or Instagram
 * not-found marks a publish removed only when the same token still reads
 * the channel (`GET /{page or ig user}?fields=id`): a channel that lost its
 * permission must not have every post marked removed.
 */

const calls = vi.hoisted(() => ({
  probes: [] as string[],
  removed: [] as string[],
}));

const metaFetch = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@kit/shared/vendors', () => ({
  metaFetch: (path: string, init: unknown) => {
    calls.probes.push(path);
    return metaFetch(path, init);
  },
}));
vi.mock('@kit/publishing/lib/publish-removal', () => ({
  notFoundOn: (platform: string) => `not found on ${platform}`,
  recordPublishRemoved: async (_client: unknown, id: string) => {
    calls.removed.push(id);
    return true;
  },
}));

const { markMetaPublishRemoved } = await import(
  '../src/server/content-removal'
);

const PAGE = '1234567890';

const client = {
  from: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: { platform_account_id: PAGE },
        error: null,
      }),
    };
    return builder;
  },
} as unknown as Parameters<typeof markMetaPublishRemoved>[0];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const publish = (id: string, connection = 'conn-fb') => ({
  id,
  platform_connection_id: connection,
});

beforeEach(() => {
  metaFetch.mockReset();
  calls.probes = [];
  calls.removed = [];
});

describe('a Meta not-found, confirmed by reading the channel (KB-207)', () => {
  it('marks the publish removed when the token still reads the Page', async () => {
    metaFetch.mockImplementation(async () => json({ id: PAGE }));

    const marked = await markMetaPublishRemoved(
      client,
      publish('p1'),
      'facebook',
      'token',
      new Map(),
    );

    expect(marked).toBe(true);
    expect(calls.probes).toEqual([`/${PAGE}?fields=id`]);
    expect(calls.removed).toEqual(['p1']);
  });

  it.each([
    [
      'a lost permission',
      () =>
        json(
          {
            error: {
              message: 'Requires pages_read_engagement permission',
              code: 10,
            },
          },
          403,
        ),
    ],
    [
      'an expired token',
      () => json({ error: { message: 'Session has expired', code: 190 } }, 400),
    ],
    [
      'the Page itself unreadable',
      () =>
        json({ error: { code: 100, error_subcode: 33, message: 'x' } }, 400),
    ],
    [
      'a network failure',
      () => {
        throw new Error('fetch failed');
      },
    ],
  ])('marks nothing when the probe meets %s', async (_name, answer) => {
    metaFetch.mockImplementation(async () => answer());

    const marked = await markMetaPublishRemoved(
      client,
      publish('p1'),
      'instagram',
      'token',
      new Map(),
    );

    expect(marked).toBe(false);
    expect(calls.removed).toEqual([]);
  });

  it('probes each channel once per run, not once per video', async () => {
    metaFetch.mockImplementation(async () => json({ id: PAGE }));
    const probes = new Map();

    await Promise.all(
      ['p1', 'p2', 'p3'].map((id) =>
        markMetaPublishRemoved(client, publish(id), 'facebook', 't', probes),
      ),
    );
    await markMetaPublishRemoved(
      client,
      publish('p4', 'conn-ig'),
      'instagram',
      't',
      probes,
    );

    expect(calls.probes).toHaveLength(2);
    expect(calls.removed.sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});
