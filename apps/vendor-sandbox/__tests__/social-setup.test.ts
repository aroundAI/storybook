import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decrypt, encrypt } from '@kit/shared/crypto';
import { VENDORS, vendorUrl, vendorUrlEnvName } from '@kit/shared/vendors';

import {
  CLIENT_ENV,
  SANDBOX_CLIENTS,
  TABLE_CLIENTS,
} from '../src/social/credentials';
import { socialEnvLines } from '../src/social/env-lines';
import { seedCredentials, seedEnv } from '../src/social/seed-credentials';
import { SOCIAL_ORIGINS } from '../src/social/server';

/**
 * FILM-1802 criteria 1 and 2's set-up: the env block points every social
 * vendor at the sandbox, and the local database holds the sandbox's
 * YouTube and Meta clients, encrypted the way the app reads them. Nothing
 * here can reach a database or vendor that is not on this machine.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function envFrom(lines: string[]) {
  return Object.fromEntries(
    lines
      .filter((line) => !line.startsWith('#'))
      .map((line) => line.split('=', 2) as [string, string]),
  );
}

describe('the env block', () => {
  const lines = socialEnvLines(4100, vendorUrlEnvName);
  const env = envFrom(lines);

  it('names every resolver entry the social origins stand in for, and no other', () => {
    const named = Object.values(SOCIAL_ORIGINS).flatMap((o) => [
      ...o.resolverNames,
    ]);
    for (const name of named) expect(Object.keys(VENDORS)).toContain(name);
    expect(
      Object.keys(env)
        .filter((k) => k.startsWith('VENDOR_URL_'))
        .sort(),
    ).toEqual(named.map(vendorUrlEnvName).sort());
  });

  it('the app resolves each of them to the sandbox, as it will in development', () => {
    const appEnv = { NODE_ENV: 'development', VENDOR_SANDBOX: '1', ...env };
    for (const [origin, { port, resolverNames }] of Object.entries(
      SOCIAL_ORIGINS,
    )) {
      for (const name of resolverNames) {
        expect(vendorUrl(name, appEnv), `${origin} ${name}`).toBe(
          `http://127.0.0.1:${port}`,
        );
      }
    }
  });

  it('and to the real vendor in production, whatever the block says', () => {
    const production = { NODE_ENV: 'production', VENDOR_SANDBOX: '1', ...env };
    expect(vendorUrl('youtube-data', production)).toBe(VENDORS['youtube-data']);
  });

  it('SANDBOX_PORT_BASE shifts every port', () => {
    expect(
      envFrom(socialEnvLines(5100, vendorUrlEnvName)).VENDOR_URL_TIKTOK,
    ).toBe('http://127.0.0.1:5102');
  });

  it('carries the sandbox clients for the three env-configured apps', () => {
    for (const [app, [idVar, secretVar]] of Object.entries(CLIENT_ENV)) {
      const client = SANDBOX_CLIENTS[app as keyof typeof CLIENT_ENV];
      expect(env[idVar]).toBe(client.clientId);
      expect(env[secretVar]).toBe(client.clientSecret);
    }
  });
});

describe('seed-credentials', () => {
  const local = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };

  it.each([
    'https://abcdefghijkl.supabase.co',
    'http://db.internal.example:5432',
    'http://127.0.0.1.example.com',
    '',
  ])('refuses a Supabase that is not on this machine: %s', (url) => {
    expect(() => seedEnv({ ...local, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow(
      /only to a Supabase on this machine/,
    );
  });

  it('refuses without the key the app decrypts with', () => {
    expect(() => seedEnv({ ...local, ENCRYPTION_KEY: '' })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it("writes the YouTube and Meta clients, encrypted so the app's decrypt reads them", async () => {
    vi.stubEnv('ENCRYPTION_KEY', local.ENCRYPTION_KEY);
    const sent: Array<{
      url: string;
      body: string;
      headers: Record<string, string>;
    }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: String(init.body),
        headers: init.headers as Record<string, string>,
      });
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const seeded = await seedCredentials(seedEnv(local), encrypt, fakeFetch);

    expect(seeded).toEqual([...TABLE_CLIENTS]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(
      'http://127.0.0.1:55321/rest/v1/oauth_app_credentials?on_conflict=platform',
    );
    expect(sent[0]!.headers.Prefer).toContain('resolution=merge-duplicates');

    const rows = JSON.parse(sent[0]!.body) as Array<{
      platform: 'youtube' | 'meta';
      client_id: string;
      client_secret_encrypted: string;
    }>;
    for (const row of rows) {
      expect(row.client_id).toBe(SANDBOX_CLIENTS[row.platform].clientId);
      expect(row.client_secret_encrypted).not.toContain('secret');
      expect(await decrypt(row.client_secret_encrypted)).toBe(
        SANDBOX_CLIENTS[row.platform].clientSecret,
      );
    }
  });

  it('reports a refused write instead of claiming success', async () => {
    vi.stubEnv('ENCRYPTION_KEY', local.ENCRYPTION_KEY);
    const refusing = (async () =>
      new Response('permission denied', {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(
      seedCredentials(seedEnv(local), encrypt, refusing),
    ).rejects.toThrow(/401/);
  });
});
