import { NextRequest } from 'next/server';

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONNECT_PLATFORMS } from '../connect-failure';
import {
  connectedLanding,
  platformsPageUrl,
  resolveConnectAccount,
} from '../connect-landing';

const ACCOUNT_ID = '7d0e2f6c-1a4b-4c8e-9f30-5b6a7c8d9e0f';
const API = resolve(__dirname, '../../../app/api/platforms');

/** The one query the helpers make: `accounts` by id or by slug. */
function clientWith(row: Record<string, string> | null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));

  return {
    client: { from: vi.fn(() => ({ select: () => ({ eq }) })) },
    eq,
  } as unknown as {
    client: Parameters<typeof platformsPageUrl>[1];
    eq: typeof eq;
  };
}

function request(url: string) {
  return new NextRequest(new URL(url));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('connectedLanding (KB-87)', () => {
  it('lands on the account’s platforms page, absolute, on the configured origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
    const { client } = clientWith({ slug: 'acme' });

    const response = await connectedLanding(
      request('https://attacker.example/api/platforms/callback/twitter'),
      client,
      ACCOUNT_ID,
      { success: 'twitter_connected', username: 'acme & co' },
    );

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/home/acme/settings/platforms?success=twitter_connected&username=acme+%26+co',
    );
  });

  it('falls back to the landing route for an account with no slug', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const { client } = clientWith({ slug: null as unknown as string });

    const url = await platformsPageUrl(
      request('http://localhost:3000/api/platforms/callback/tiktok'),
      client,
      ACCOUNT_ID,
    );

    expect(url.toString()).toBe('http://localhost:3000/settings/platforms');
  });
});

describe('resolveConnectAccount (KB-86)', () => {
  it('takes an account id as given', async () => {
    const { client, eq } = clientWith(null);

    expect(
      await resolveConnectAccount(
        request(`http://x.test/c?accountId=${ACCOUNT_ID}`),
        client,
      ),
    ).toEqual({ accountId: ACCOUNT_ID });
    expect(eq).not.toHaveBeenCalled();
  });

  it('resolves the slug the settings page sends', async () => {
    const { client, eq } = clientWith({ id: ACCOUNT_ID });

    expect(
      await resolveConnectAccount(
        request('http://x.test/c?account=acme'),
        client,
      ),
    ).toEqual({ accountId: ACCOUNT_ID });
    expect(eq).toHaveBeenCalledWith('slug', 'acme');
  });

  it('says which is wrong: nothing named, or nothing found', async () => {
    expect(
      await resolveConnectAccount(
        request('http://x.test/c'),
        clientWith(null).client,
      ),
    ).toEqual({ error: 'missing' });
    expect(
      await resolveConnectAccount(
        request('http://x.test/c?account=nope'),
        clientWith(null).client,
      ),
    ).toEqual({ error: 'not_found', slug: 'nope' });
  });
});

/**
 * The class, not the instance: a redirect built from a string is how three
 * callbacks came to send a relative URL. Every redirect in the connect and
 * callback routes is a `URL` or goes through a helper that builds one.
 */
describe('no connect or callback route redirects to a string (KB-87)', () => {
  const routes = ['connect', 'callback'].flatMap((kind) =>
    readdirSync(join(API, kind)).map((platform) =>
      join(kind, platform, 'route.ts'),
    ),
  );

  it('finds a connect and a callback route for every platform', () => {
    for (const platform of CONNECT_PLATFORMS) {
      expect(routes).toContain(join('callback', platform, 'route.ts'));
      expect(routes).toContain(join('connect', platform, 'route.ts'));
    }
  });

  it.each(routes)('%s', (route) => {
    const source = readFileSync(join(API, route), 'utf8');
    const stringRedirects = source.match(
      /NextResponse\.redirect\(\s*[`'"][^)]*/g,
    );

    expect(stringRedirects ?? []).toEqual([]);
  });

  // LinkedIn's connect route refuses before resolving anything (FILM-717).
  it.each(['twitter', 'youtube', 'tiktok', 'meta'])(
    'connect/%s resolves the account through resolveConnectAccount',
    (platform) => {
      const source = readFileSync(
        join(API, 'connect', platform, 'route.ts'),
        'utf8',
      );

      expect(source).toContain('resolveConnectAccount(');
    },
  );
});
