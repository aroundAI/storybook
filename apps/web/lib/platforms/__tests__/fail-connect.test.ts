import { NextRequest, NextResponse } from 'next/server';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECT_PLATFORMS } from '../connect-failure';
import {
  CONNECT_FAILED_LOG_MESSAGE,
  catchConnectFailures,
  failConnect,
  redactSecrets,
  vendorRefusal,
} from '../fail-connect';

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => logger,
}));

const ACCOUNT_ID = '7d0e2f6c-1a4b-4c8e-9f30-5b6a7c8d9e0f';

// Everything a callback holds that must never reach a log line or a URL.
const SECRETS = {
  code: '4/0AfJohXnCODEcodeCODE',
  state: Buffer.from(
    JSON.stringify({ accountId: ACCOUNT_ID, nonce: 'NONCE-5ecret-nonce' }),
  ).toString('base64url'),
  accessToken: 'ya29.ACCESS-token-value',
  refreshToken: '1//REFRESH-token-value',
  clientSecret: 'GOCSPX-client-secret-value',
  codeVerifier: 'pkce-VERIFIER-value',
};

function callbackRequest(params: Record<string, string> = {}) {
  return new NextRequest(
    `https://app.example/api/platforms/callback/youtube?${new URLSearchParams({
      code: SECRETS.code,
      state: SECRETS.state,
      ...params,
    })}`,
  );
}

/** What a vendor's redirect carries besides the code and the state. */
function refusal(error: string, description: string, logId?: string) {
  return vendorRefusal(
    error,
    new URLSearchParams({
      code: SECRETS.code,
      state: SECRETS.state,
      error,
      error_description: description,
      ...(logId ? { log_id: logId } : {}),
    }),
  );
}

function lastLogLine() {
  expect(logger.error).toHaveBeenCalledTimes(1);

  const [fields, message] = logger.error.mock.calls[0]!;

  return { fields, message, text: JSON.stringify([fields, message]) };
}

function expectNoSecrets(text: string) {
  for (const [name, secret] of Object.entries(SECRETS)) {
    expect(text, `${name} leaked`).not.toContain(secret);
  }

  expect(text).not.toContain('NONCE-5ecret-nonce');
}

beforeEach(() => {
  logger.error.mockClear();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
});

describe('failConnect writes one log line', () => {
  it('names the platform, our code, the branch and what the vendor said', async () => {
    await failConnect({
      request: callbackRequest(),
      platform: 'tiktok',
      accountId: ACCOUNT_ID,
      ...refusal(
        'invalid_scope',
        'Scope video.list is not authorized',
        '20260922ABCDEF',
      ),
    });

    const { fields, message } = lastLogLine();

    expect(message).toBe(CONNECT_FAILED_LOG_MESSAGE);
    expect(message).toBe('Platform connect failed');
    expect(fields).toEqual({
      name: 'oauth.tiktok.callback',
      platform: 'tiktok',
      code: 'invalid_scope',
      branch: 'vendor_refused',
      accountId: ACCOUNT_ID,
      vendorError: 'invalid_scope',
      vendorErrorDescription: 'Scope video.list is not authorized',
      vendorLogId: '20260922ABCDEF',
      status: undefined,
      cause: undefined,
    });
  });

  it('never carries the code, the state, a token or a secret', async () => {
    // The worst case a branch can hand over: a cause and a vendor message
    // that quote the request and the token response back at us.
    const response = await failConnect({
      request: callbackRequest(),
      platform: 'youtube',
      accountId: ACCOUNT_ID,
      code: 'token_exchange_failed',
      branch: 'token_exchange',
      status: 400,
      vendor: {
        error: 'invalid_grant',
        description: `Bad request: code=${SECRETS.code}&code_verifier=${SECRETS.codeVerifier}&client_secret=${SECRETS.clientSecret} state=${SECRETS.state}`,
      },
      cause: {
        message: `fetch failed for https://graph.example/me?access_token=${SECRETS.accessToken} {"refresh_token":"${SECRETS.refreshToken}"} Authorization: Bearer ${SECRETS.accessToken}`,
        access_token: SECRETS.accessToken,
        refresh_token: SECRETS.refreshToken,
      },
    });

    const { fields, text } = lastLogLine();

    expectNoSecrets(text);
    expectNoSecrets(response.headers.get('location') ?? '');
    expect(fields.vendorErrorDescription).toContain('code=[redacted]');
    expect(fields.cause.message).toContain('access_token=[redacted]');
  });

  it('keeps only the name, code and message of a cause', async () => {
    await failConnect({
      request: callbackRequest(),
      platform: 'meta',
      code: 'storage_failed',
      branch: 'connection_upsert',
      cause: {
        code: '42501',
        message: 'new row violates row-level security policy',
        details: SECRETS.accessToken,
        tokens: { access_token: SECRETS.accessToken },
      },
    });

    expect(lastLogLine().fields.cause).toEqual({
      name: null,
      code: '42501',
      message: 'new row violates row-level security policy',
    });
  });

  it('cuts a long vendor message and flattens one that tries to forge lines', async () => {
    await failConnect({
      request: callbackRequest(),
      platform: 'twitter',
      ...refusal(
        'access_denied',
        `denied\n{"level":"error","msg":"forged"}\u2028${'A'.repeat(5000)}`,
      ),
    });

    const { vendorErrorDescription } = lastLogLine().fields;

    expect(vendorErrorDescription).not.toMatch(/[\n\r\u2028]/);
    expect(vendorErrorDescription.length).toBe(301);
  });
});

describe('failConnect redirects to the landing, on our own origin', () => {
  it('carries our code, the platform, the vendor’s words and the account', async () => {
    const response = await failConnect({
      request: callbackRequest(),
      platform: 'youtube',
      accountId: ACCOUNT_ID,
      ...refusal('access_denied', 'The user denied the request', 'LOG-1'),
    });

    const location = new URL(response.headers.get('location')!);

    expect(response.status).toBe(307);
    expect(location.origin).toBe('https://app.example');
    expect(location.pathname).toBe('/settings/platforms');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      error: 'access_denied',
      platform: 'youtube',
      vendor_code: 'access_denied',
      vendor_message: 'The user denied the request',
      vendor_log_id: 'LOG-1',
      account: ACCOUNT_ID,
    });
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '../../auth/sign-out',
    'javascript:alert(1)',
  ])('drops an account that is not a UUID: %s', async (accountId) => {
    const response = await failConnect({
      request: callbackRequest(),
      platform: 'youtube',
      accountId,
      code: 'invalid_state',
      branch: 'state_unreadable',
    });

    const location = new URL(response.headers.get('location')!);

    expect(location.origin).toBe('https://app.example');
    expect(location.pathname).toBe('/settings/platforms');
    expect(location.searchParams.has('account')).toBe(false);
    expect(lastLogLine().fields.accountId).toBeNull();
  });

  it('uses the configured origin, not the one the request claims', async () => {
    const response = await failConnect({
      request: new NextRequest('https://evil.example/api/platforms/callback/x'),
      platform: 'twitter',
      code: 'missing_params',
      branch: 'missing_params',
    });

    expect(new URL(response.headers.get('location')!).origin).toBe(
      'https://app.example',
    );
  });

  it('falls back to the request’s origin when none is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    const response = await failConnect({
      request: new NextRequest(
        'http://localhost:3000/api/platforms/callback/x',
      ),
      platform: 'twitter',
      code: 'missing_params',
      branch: 'missing_params',
    });

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/platforms?error=missing_params&platform=twitter',
    );
  });
});

describe('catchConnectFailures', () => {
  it('turns a throw into a logged failure instead of a 500', async () => {
    const GET = catchConnectFailures('tiktok', async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    });

    const response = await GET(callbackRequest());
    const location = new URL(response.headers.get('location')!);
    const { fields, text } = lastLogLine();

    expect(location.searchParams.get('error')).toBe('unexpected');
    expect(location.searchParams.get('account')).toBe(ACCOUNT_ID);
    expect(fields).toMatchObject({
      platform: 'tiktok',
      code: 'unexpected',
      branch: 'uncaught',
      cause: { name: 'SyntaxError' },
    });
    expectNoSecrets(text);
  });

  it('passes a response through untouched', async () => {
    const ok = NextResponse.json({ ok: true });
    const GET = catchConnectFailures('tiktok', async () => ok);

    expect(await GET(callbackRequest())).toBe(ok);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('redactSecrets', () => {
  it.each([
    ['code=abc123&x=1', 'code=[redacted]&x=1'],
    ['{"access_token":"abc"}', '{"access_token":"[redacted]"}'],
    ['Authorization: Bearer abc.def', 'Authorization: [redacted]'],
    ['client_secret = s3cret', 'client_secret = [redacted]'],
  ])('%s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('leaves an ordinary vendor message alone', () => {
    const message = 'The user denied the request for scope video.list';

    expect(redactSecrets(message)).toBe(message);
  });
});

describe('the callbacks give up through failConnect and nowhere else', () => {
  it.each(CONNECT_PLATFORMS)('callback/%s/route.ts', (platform) => {
    const source = readFileSync(
      resolve(
        __dirname,
        `../../../app/api/platforms/callback/${platform}/route.ts`,
      ),
      'utf8',
    );

    // The path that 404'd, and any hand-built failure redirect beside it.
    expect(source).not.toMatch(/settings\/platforms\?error/);
    expect(source).not.toMatch(/[?&]error=/);

    // A token response is the tokens. It was being logged whole.
    expect(source).not.toMatch(/logger\.\w+\(\s*\{[^}]*\btokens\b/);

    expect(source).toContain(`platform: '${platform}'`);
    expect(source).toContain(
      `export const GET = catchConnectFailures('${platform}', handleCallback);`,
    );
  });
});
