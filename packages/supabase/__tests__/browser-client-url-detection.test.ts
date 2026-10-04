import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COOKIE = 'sb-test-auth-token';

function createCookieJar() {
  const jar = new Map<string, string>();

  return {
    jar,
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    set cookie(line: string) {
      const [pair = '', ...attributes] = line.split(';').map((s) => s.trim());
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = attributes.some(
        (attribute) =>
          /^max-age=0$/i.test(attribute) ||
          (/^expires=/i.test(attribute) &&
            new Date(attribute.slice(8)).getTime() < Date.now()),
      );

      if (expired) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    },
  };
}

function storedSession() {
  const session = {
    access_token: 'access',
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', aud: 'authenticated', app_metadata: {} },
  };

  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

async function openPage(href: string) {
  const document = createCookieJar();
  document.jar.set(COOKIE, storedSession());

  vi.stubGlobal('document', document);
  vi.stubGlobal('window', {
    document,
    location: { href },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });

  vi.resetModules();

  const { getSupabaseBrowserClient } = await import(
    '../src/clients/browser-client'
  );

  return { client: getSupabaseBrowserClient(), jar: document.jar };
}

describe('browser client does not read the page URL (KB-176)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // One client for both checks: @supabase/ssr caches the browser client in a
  // module-level singleton that vi.resetModules cannot reach, so a second
  // client in this file would be the first one, already initialised.
  it('turns off URL detection and keeps the session on an error_description URL', async () => {
    const { client, jar } = await openPage(
      'https://app.test/home/acme/settings?error=access_denied&error_description=x',
    );

    expect(
      (client.auth as unknown as { detectSessionInUrl: boolean })
        .detectSessionInUrl,
    ).toBe(false);

    await client.auth.initialize();

    expect(jar.has(COOKIE)).toBe(true);
  });
});
