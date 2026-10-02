import { expect, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';
import { consentForm } from './x-helpers';

export const APP = 'http://localhost:3132';

const FREE_PORTS = {
  control: 0,
  openai: 0,
  gemini: 0,
  elevenlabs: 0,
  meta: 0,
  tiktok: 0,
  google: 0,
  x: 0,
};

/** A sandbox on free ports with a clock the test moves, and the app's env pointed at TikTok. */
export async function tiktokSandbox(
  seed: number,
  clock: () => number,
  speed = 1,
): Promise<Sandbox> {
  const sandbox = await createSandbox({
    seed,
    speed,
    now: clock,
    ports: FREE_PORTS,
  });
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
  for (const name of ['TIKTOK', 'TIKTOK_OAUTH']) {
    vi.stubEnv(`VENDOR_URL_${name}`, sandbox.urls.tiktok);
  }
  return sandbox;
}

export interface TikTokTokens {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

export const CREDENTIALS = SANDBOX_CLIENTS.tiktok;

/**
 * The connect route's authorize URL (PKCE and all), the consent page's Allow
 * with `granted` ticked, and the callback's code exchange: the app's own
 * OAuth config throughout.
 */
export async function connectTikTok(
  sandbox: Sandbox,
  options: {
    requested?: readonly string[];
    granted?: readonly string[];
    verifier?: string;
  } = {},
) {
  const { TIKTOK_OAUTH_CONFIG, generateCodeChallenge, generateCodeVerifier } =
    await import('@kit/publishing/oauth/tiktok');
  const requested = options.requested ?? TIKTOK_OAUTH_CONFIG.scopes;
  const granted = options.granted ?? requested;
  const verifier = generateCodeVerifier();
  const authorize = new URL(TIKTOK_OAUTH_CONFIG.authUrl);
  authorize.search = new URLSearchParams({
    client_key: CREDENTIALS.clientId,
    redirect_uri: `${APP}/api/platforms/callback/tiktok`,
    response_type: 'code',
    scope: requested.join(','),
    state: 'nonce-state',
    code_challenge: await generateCodeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();

  const page = await fetch(authorize);
  expect(page.status).toBe(200);
  const { action, hidden } = consentForm(await page.text());
  const form = new URLSearchParams({ ...hidden, decision: 'allow' });
  for (const scope of granted) form.append('scope', scope);

  const decided = await fetch(`${sandbox.urls.tiktok}${action}`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const back = new URL(decided.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(
    `${APP}/api/platforms/callback/tiktok`,
  );
  expect(back.searchParams.get('state')).toBe('nonce-state');

  const response = await fetch(TIKTOK_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
      code: back.searchParams.get('code')!,
      grant_type: 'authorization_code',
      redirect_uri: `${APP}/api/platforms/callback/tiktok`,
      code_verifier: options.verifier ?? verifier,
    }),
  });
  return { status: response.status, body: (await response.json()) as never };
}

export async function connectedTikTok(
  sandbox: Sandbox,
  options: { requested?: readonly string[]; granted?: readonly string[] } = {},
) {
  const result = await connectTikTok(sandbox, options);
  expect(result.status).toBe(200);
  return result.body as TikTokTokens;
}

/** What the token-refresh cron sends: a refresh grant with the app's client. */
export async function refreshTikTok(refreshToken: string) {
  const { TIKTOK_OAUTH_CONFIG } = await import('@kit/publishing/oauth/tiktok');
  const response = await fetch(TIKTOK_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return { status: response.status, body: (await response.json()) as never };
}

/** What `revokeTikTokAccess` sends. */
export async function revokeTikTok(accessToken: string) {
  const { TIKTOK_OAUTH_CONFIG } = await import('@kit/publishing/oauth/tiktok');
  return fetch(TIKTOK_OAUTH_CONFIG.revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
      token: accessToken,
    }),
  });
}
