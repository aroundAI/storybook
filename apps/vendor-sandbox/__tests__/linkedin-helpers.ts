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
  linkedin: 0,
};

/** A sandbox on free ports with a clock the test moves, and the app's env pointed at LinkedIn. */
export async function linkedInSandbox(
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
  for (const name of ['LINKEDIN_API', 'LINKEDIN_OAUTH']) {
    vi.stubEnv(`VENDOR_URL_${name}`, sandbox.urls.linkedin);
  }
  return sandbox;
}

export interface LinkedInTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
}

export const CREDENTIALS = SANDBOX_CLIENTS.linkedin;

/**
 * The connect route's authorize URL asking for `requested`, the consent
 * page's Allow with `granted` ticked, and the callback's code exchange — the
 * app's own OAuth config throughout.
 */
export async function connectLinkedIn(
  sandbox: Sandbox,
  options: { requested?: readonly string[]; granted?: readonly string[] } = {},
) {
  const { LINKEDIN_OAUTH_CONFIG } = await import(
    '@kit/publishing/oauth/linkedin'
  );
  const requested = options.requested ?? LINKEDIN_OAUTH_CONFIG.scopes.personal;
  const granted = options.granted ?? requested;
  const authorize = new URL(LINKEDIN_OAUTH_CONFIG.authUrl);
  authorize.search = new URLSearchParams({
    client_id: CREDENTIALS.clientId,
    redirect_uri: `${APP}/api/platforms/callback/linkedin`,
    response_type: 'code',
    scope: requested.join(' '),
    state: 'nonce-state',
  }).toString();

  const page = await fetch(authorize);
  expect(page.status).toBe(200);
  const { action, hidden } = consentForm(await page.text());
  const form = new URLSearchParams({ ...hidden, decision: 'allow' });
  for (const scope of granted) form.append('scope', scope);

  const decided = await fetch(`${sandbox.urls.linkedin}${action}`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const back = new URL(decided.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(
    `${APP}/api/platforms/callback/linkedin`,
  );
  expect(back.searchParams.get('state')).toBe('nonce-state');

  const response = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      client_id: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
      redirect_uri: `${APP}/api/platforms/callback/linkedin`,
    }),
  });
  return { status: response.status, body: (await response.json()) as never };
}

export async function connectedLinkedIn(
  sandbox: Sandbox,
  options: { requested?: readonly string[]; granted?: readonly string[] } = {},
) {
  const result = await connectLinkedIn(sandbox, options);
  expect(result.status).toBe(200);
  return result.body as LinkedInTokens;
}

/** What the token-refresh cron sends: a refresh grant with the app's client. */
export async function refreshLinkedIn(refreshToken: string) {
  const { LINKEDIN_OAUTH_CONFIG } = await import(
    '@kit/publishing/oauth/linkedin'
  );
  const response = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
    }),
  });
  return { status: response.status, body: (await response.json()) as never };
}
