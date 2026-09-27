import { expect, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';

export const APP = 'http://localhost:3132';
export const ALL_YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
];

const FREE_PORTS = {
  control: 0,
  openai: 0,
  gemini: 0,
  elevenlabs: 0,
  meta: 0,
  tiktok: 0,
  google: 0,
  x: 0,
  linkedin: 0,
};

/** A sandbox on free ports with a clock the test moves, and the app's env pointed at it. */
export async function googleSandbox(
  seed: number,
  clock: () => number,
  speed = 1,
) {
  const sandbox = await createSandbox({
    seed,
    speed,
    now: clock,
    ports: FREE_PORTS,
  });
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
  for (const name of [
    'GOOGLE_OAUTH',
    'GOOGLE_TOKEN',
    'YOUTUBE_DATA',
    'YOUTUBE_ANALYTICS',
    'YOUTUBE_REPORTING',
  ]) {
    vi.stubEnv(`VENDOR_URL_${name}`, sandbox.urls.google);
  }
  return sandbox;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * The connect route's authorize URL, the consent page's Allow with `scopes`
 * ticked, and the callback's code exchange — the real OAuth config throughout.
 */
export async function connectYouTube(
  sandbox: Sandbox,
  scopes = ALL_YOUTUBE_SCOPES,
) {
  const { YOUTUBE_OAUTH_CONFIG } = await import(
    '@kit/publishing/oauth/youtube'
  );
  const authorize = new URL(YOUTUBE_OAUTH_CONFIG.authUrl);
  authorize.search = new URLSearchParams({
    client_id: SANDBOX_CLIENTS.youtube.clientId,
    redirect_uri: `${APP}/api/platforms/callback/youtube`,
    response_type: 'code',
    scope: YOUTUBE_OAUTH_CONFIG.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: 'nonce-state',
  }).toString();

  const page = await fetch(authorize);
  expect(page.status).toBe(200);
  const html = await page.text();
  const action = /action="([^"]+)"/.exec(html)![1]!;
  const hidden = Object.fromEntries(
    [...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(
      ([, k, v]) => [k, v],
    ),
  );
  const form = new URLSearchParams({ ...hidden, decision: 'allow' });
  for (const scope of scopes) form.append('scope', scope);

  const decided = await fetch(`${sandbox.urls.google}${action}`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const back = new URL(decided.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(
    `${APP}/api/platforms/callback/youtube`,
  );
  expect(back.searchParams.get('state')).toBe('nonce-state');

  const tokenResponse = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: back.searchParams.get('code')!,
      client_id: SANDBOX_CLIENTS.youtube.clientId,
      client_secret: SANDBOX_CLIENTS.youtube.clientSecret,
      redirect_uri: `${APP}/api/platforms/callback/youtube`,
      grant_type: 'authorization_code',
    }),
  });
  return (await tokenResponse.json()) as GoogleTokens;
}

/** What the token-refresh cron does before a sync: a refresh grant. */
export async function refreshYouTube(refreshToken: string) {
  const { YOUTUBE_OAUTH_CONFIG } = await import(
    '@kit/publishing/oauth/youtube'
  );
  const response = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: SANDBOX_CLIENTS.youtube.clientId,
      client_secret: SANDBOX_CLIENTS.youtube.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return (await response.json()) as Record<string, unknown>;
}
