import { expect, vi } from 'vitest';

import { type Sandbox, createSandbox } from '../src/sandbox';
import { SANDBOX_CLIENTS } from '../src/social/credentials';

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

/** A sandbox on free ports with a clock the test moves, and the app's env pointed at X. */
export async function xSandbox(
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
  for (const name of ['X_API', 'X_OAUTH']) {
    vi.stubEnv(`VENDOR_URL_${name}`, sandbox.urls.x);
  }
  return sandbox;
}

export interface XTokens {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
}

/** A consent page's hidden inputs and form action. */
export function consentForm(html: string) {
  return {
    action: /action="([^"]+)"/.exec(html)![1]!,
    hidden: Object.fromEntries(
      [...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(
        ([, k, v]) => [k, v],
      ),
    ),
  };
}

export const CREDENTIALS = {
  clientId: SANDBOX_CLIENTS.twitter.clientId,
  clientSecret: SANDBOX_CLIENTS.twitter.clientSecret,
};

/**
 * The connect route's authorize URL (PKCE challenge and all), the consent
 * page's Allow with `scopes` ticked, and the callback's code exchange: the
 * app's own OAuth config and Basic-auth helper throughout.
 */
export async function connectX(
  sandbox: Sandbox,
  scopes?: readonly string[],
  overrides: { verifier?: string } = {},
) {
  const {
    TWITTER_OAUTH_CONFIG,
    generateCodeChallenge,
    generateCodeVerifier,
    xClientAuthorization,
  } = await import('@kit/publishing/oauth/twitter');
  const granted = scopes ?? TWITTER_OAUTH_CONFIG.scopes;
  const verifier = generateCodeVerifier();
  const authorize = new URL(TWITTER_OAUTH_CONFIG.authUrl);
  authorize.search = new URLSearchParams({
    client_id: CREDENTIALS.clientId,
    redirect_uri: `${APP}/api/platforms/callback/twitter`,
    response_type: 'code',
    scope: TWITTER_OAUTH_CONFIG.scopes.join(' '),
    state: 'nonce-state',
    code_challenge: await generateCodeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();

  const page = await fetch(authorize);
  expect(page.status).toBe(200);
  const { action, hidden } = consentForm(await page.text());
  const form = new URLSearchParams({ ...hidden, decision: 'allow' });
  for (const scope of granted) form.append('scope', scope);

  const decided = await fetch(`${sandbox.urls.x}${action}`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const back = new URL(decided.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(
    `${APP}/api/platforms/callback/twitter`,
  );
  expect(back.searchParams.get('state')).toBe('nonce-state');

  const response = await fetch(TWITTER_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: xClientAuthorization(CREDENTIALS),
    },
    body: new URLSearchParams({
      code: back.searchParams.get('code')!,
      grant_type: 'authorization_code',
      redirect_uri: `${APP}/api/platforms/callback/twitter`,
      code_verifier: overrides.verifier ?? verifier,
    }),
  });
  return { status: response.status, body: (await response.json()) as never };
}

export async function connectedX(sandbox: Sandbox, scopes?: readonly string[]) {
  const result = await connectX(sandbox, scopes);
  expect(result.status).toBe(200);
  return result.body as XTokens;
}

/** What the token-refresh cron does: a refresh grant with the app's Basic auth. */
export async function refreshX(refreshToken: string) {
  const { TWITTER_OAUTH_CONFIG, xClientAuthorization } = await import(
    '@kit/publishing/oauth/twitter'
  );
  const response = await fetch(TWITTER_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: xClientAuthorization(CREDENTIALS),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  return { status: response.status, body: (await response.json()) as never };
}

/** What `revokeTwitterAccess` sends for one token. */
export async function revokeX(token: string) {
  const { TWITTER_OAUTH_CONFIG, xClientAuthorization } = await import(
    '@kit/publishing/oauth/twitter'
  );
  const response = await fetch(TWITTER_OAUTH_CONFIG.revokeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: xClientAuthorization(CREDENTIALS),
    },
    body: new URLSearchParams({ token }),
  });
  return { status: response.status, body: (await response.json()) as never };
}
