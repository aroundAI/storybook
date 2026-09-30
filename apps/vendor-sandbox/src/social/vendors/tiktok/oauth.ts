import { createHash } from 'node:crypto';

import { sendJson } from '../../../http';
import { SANDBOX_CLIENTS } from '../../credentials';
import {
  consentPage,
  formOf,
  redirect,
  sendHtml,
  withParams,
} from '../../oauth';
import type { SocialRoute } from '../../server';
import type { SocialState } from '../../state';
import { KNOWN_SCOPES } from './errors';

/**
 * TikTok Login Kit for the web
 * (https://developers.tiktok.com/doc/oauth-user-access-token-management):
 * the authorize page on www.tiktok.com, the token endpoint (code and refresh
 * grants) and revoke, on the API host. Scopes are comma-separated, on the
 * request and in the token response.
 *
 * Documented: 24-hour access tokens, 365-day refresh tokens, and a refresh
 * that returns a new refresh token — the sandbox invalidates the old one, so
 * an app that keeps the first one fails at the next refresh. Inferred
 * (capability reference ledger): the error bodies' status codes, that a
 * challenge sent to authorize is checked at the token endpoint, in base64url
 * or hex, and that revoke ends the whole grant.
 */

const CLIENT = SANDBOX_CLIENTS.tiktok;
const ACCESS_TTL_S = 86_400;
const REFRESH_TTL_S = 31_536_000;
const DECISION_PATH = '/v2/auth/authorize/sandbox-decision';

function tokenError(error: string, description: string) {
  return {
    error,
    error_description: description,
    log_id: '20260928170000SANDBOXTOKENERROR00',
  };
}

function pkceMatches(challenge: string, verifier: string) {
  const digest = createHash('sha256').update(verifier).digest();
  return (
    digest.toString('base64url') === challenge ||
    digest.toString('hex') === challenge
  );
}

/** GET /v2/auth/authorize/ — the consent screen. */
const authorizePage: SocialRoute = ({ url, method, res, social }) => {
  if (method !== 'GET' || url.pathname !== '/v2/auth/authorize/') return false;

  const q = url.searchParams;
  const refuse = (message: string) => {
    sendHtml(
      res,
      400,
      `<!doctype html><title>TikTok</title><h1>Something went wrong</h1><p>${message}</p>`,
    );
    return true;
  };
  if (q.get('client_key') !== CLIENT.clientId)
    return refuse('client_key: the client key is not valid.');
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!/^https?:\/\//.test(redirectUri))
    return refuse('redirect_uri: the redirect URI is not registered.');

  const state: Record<string, string> = q.get('state')
    ? { state: q.get('state')! }
    : {};
  const scopes = (q.get('scope') ?? '').split(',').filter(Boolean);
  const unknown = scopes.filter((scope) => !KNOWN_SCOPES.includes(scope));
  if (scopes.length === 0 || unknown.length > 0) {
    redirect(
      res,
      withParams(redirectUri, {
        error: 'invalid_scope',
        error_description: `The scope is invalid: ${unknown.join(',') || 'none given'}`,
        ...state,
      }),
    );
    return true;
  }

  const account = social.signedIn('tiktok');
  sendHtml(
    res,
    200,
    consentPage({
      vendor: 'TikTok',
      accountName: account.name,
      accountHandle: account.handle,
      scopes,
      action: DECISION_PATH,
      hidden: {
        client_key: CLIENT.clientId,
        redirect_uri: redirectUri,
        state: q.get('state') ?? '',
        code_challenge: q.get('code_challenge') ?? '',
      },
    }),
  );
  return true;
};

/** The consent form's own post (a sandbox path, not a TikTok one). */
const decision: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== DECISION_PATH) return false;

  const form = formOf(body);
  const redirectUri = form.get('redirect_uri') ?? '';
  const state: Record<string, string> = form.get('state')
    ? { state: form.get('state')! }
    : {};

  if (form.get('decision') !== 'allow') {
    redirect(
      res,
      withParams(redirectUri, {
        error: 'access_denied',
        error_description: 'The user denied the request.',
        ...state,
      }),
    );
    return true;
  }

  const account = social.signedIn('tiktok');
  const scopes = form.getAll('scope');
  const code = social.issueCode('tiktok', account.id, scopes, {
    clientId: form.get('client_key') ?? '',
    redirectUri,
    codeChallenge: form.get('code_challenge') || undefined,
  });
  redirect(
    res,
    withParams(redirectUri, {
      code: code.value,
      scopes: scopes.join(','),
      ...state,
    }),
  );
  return true;
};

/** The open_id a token response names: a UUID, as TikTok's are, stable per account. */
export function openIdOf(
  social: SocialState,
  accountId: string,
  kind = 'open',
) {
  const rng = social.rngFor(`tiktok-${kind}-id:${accountId}`);
  const hex = () =>
    Math.floor(rng.next() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  const [a, b, c, d] = [hex(), hex(), hex(), hex()] as const;
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

/** POST /v2/oauth/token/ — authorization_code and refresh_token grants. */
const tokenEndpoint: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== '/v2/oauth/token/') return false;

  const form = formOf(body);
  for (const name of ['client_key', 'client_secret', 'grant_type']) {
    if (!form.get(name)) {
      sendJson(
        res,
        400,
        tokenError('invalid_request', `Parameter ${name} is missing.`),
      );
      return true;
    }
  }
  if (
    form.get('client_key') !== CLIENT.clientId ||
    form.get('client_secret') !== CLIENT.clientSecret
  ) {
    sendJson(
      res,
      401,
      tokenError('invalid_client', 'Client key or secret is incorrect.'),
    );
    return true;
  }

  const grant = form.get('grant_type');
  const respond = (
    accountId: string,
    scopes: readonly string[],
    access: string,
    refresh: string,
  ) =>
    sendJson(res, 200, {
      access_token: access,
      expires_in: ACCESS_TTL_S,
      open_id: openIdOf(social, accountId),
      refresh_expires_in: REFRESH_TTL_S,
      refresh_token: refresh,
      scope: scopes.join(','),
      token_type: 'Bearer',
    });

  if (grant === 'authorization_code') {
    const redeemed = social.redeemCode(
      form.get('code') ?? '',
      CLIENT.clientId,
      form.get('redirect_uri') ?? undefined,
    );
    if (!redeemed.ok) {
      sendJson(
        res,
        400,
        tokenError(
          'invalid_grant',
          redeemed.reason === 'redirect'
            ? 'The redirect_uri does not match the authorization request.'
            : 'Authorization code is expired or invalid.',
        ),
      );
      return true;
    }
    const { codeChallenge, accountId, scopes } = redeemed.code;
    if (
      codeChallenge &&
      !pkceMatches(codeChallenge, form.get('code_verifier') ?? '')
    ) {
      sendJson(
        res,
        400,
        tokenError('invalid_grant', 'code_verifier is missing or incorrect.'),
      );
      return true;
    }
    const { access, refresh } = social.issueTokens(
      'tiktok',
      accountId,
      scopes,
      {
        ttlMs: ACCESS_TTL_S * 1000,
      },
    );
    refresh!.expiresMs = social.now() + REFRESH_TTL_S * 1000;
    respond(accountId, scopes, access.value, refresh!.value);
    return true;
  }

  if (grant === 'refresh_token') {
    const check = social.checkToken(form.get('refresh_token') ?? '');
    if (!check.ok || check.token.kind !== 'refresh') {
      sendJson(
        res,
        400,
        tokenError('invalid_grant', 'Refresh token is invalid or expired.'),
      );
      return true;
    }
    const old = check.token;
    old.revoked = true;
    const { access, refresh } = social.issueTokens(
      'tiktok',
      old.accountId,
      old.scopes,
      { ttlMs: ACCESS_TTL_S * 1000 },
    );
    refresh!.expiresMs = social.now() + REFRESH_TTL_S * 1000;
    respond(old.accountId, old.scopes, access.value, refresh!.value);
    return true;
  }

  sendJson(
    res,
    400,
    tokenError('unsupported_grant_type', `Invalid grant_type: ${grant ?? ''}`),
  );
  return true;
};

/** POST /v2/oauth/revoke/ — ends the whole grant. */
const revokeEndpoint: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== '/v2/oauth/revoke/') return false;

  const form = formOf(body);
  if (
    form.get('client_key') !== CLIENT.clientId ||
    form.get('client_secret') !== CLIENT.clientSecret
  ) {
    sendJson(
      res,
      401,
      tokenError('invalid_client', 'Client key or secret is incorrect.'),
    );
    return true;
  }
  social.revoke(form.get('token') ?? '');
  sendJson(res, 200, {});
  return true;
};

export const tiktokOAuthRoutes = [
  authorizePage,
  decision,
  tokenEndpoint,
  revokeEndpoint,
];
