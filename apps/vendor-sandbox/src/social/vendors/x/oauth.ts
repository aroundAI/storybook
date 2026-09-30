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
import { KNOWN_SCOPES, SCOPE } from './errors';

/**
 * X's OAuth 2.0 authorization code flow with PKCE
 * (https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token):
 * the authorize page on x.com, the token endpoint (code and refresh grants)
 * and revoke on the API host. PKCE is required, so a request without a
 * challenge is refused. A confidential client authenticates by Basic auth.
 *
 * Documented: two-hour access tokens, a refresh token only when
 * `offline.access` is granted, a 180-day refresh token, and a revoke that
 * "invalidates an access token or refresh token" — the sandbox revokes the
 * token it is given and nothing more. Inferred (capability reference ledger):
 * the refresh token rotates on every refresh.
 */

const CLIENT = SANDBOX_CLIENTS.twitter;
const ACCESS_TTL_S = 7200;
const REFRESH_TTL_MS = 180 * 86_400_000;
const DECISION_PATH = '/i/oauth2/authorize/sandbox-decision';

function tokenError(error: string, description: string) {
  return { error, error_description: description };
}

const INVALID_TOKEN = tokenError(
  'invalid_request',
  'Value passed for the token was invalid.',
);

/** The client id and secret from a Basic header, or from the body for a public client. */
function clientOf(header: string | undefined, form: URLSearchParams) {
  const basic = /^Basic\s+(.+)$/i.exec(header ?? '')?.[1];
  if (basic) {
    const [id, ...secret] = Buffer.from(basic, 'base64').toString().split(':');
    return { id: id ?? '', secret: secret.join(':') };
  }
  return { id: form.get('client_id') ?? '', secret: null };
}

function pkceMatches(challenge: string, verifier: string) {
  return (
    createHash('sha256').update(verifier).digest('base64url') === challenge
  );
}

/** GET /i/oauth2/authorize — the consent screen. */
const authorizePage: SocialRoute = ({ url, method, res, social }) => {
  if (method !== 'GET' || url.pathname !== '/i/oauth2/authorize') return false;

  const q = url.searchParams;
  if (q.get('client_id') !== CLIENT.clientId) {
    sendHtml(
      res,
      400,
      '<!doctype html><title>Error</title><h1>Something went wrong</h1><p>You weren’t able to give access to the App. Go back and try logging in again.</p>',
    );
    return true;
  }
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!/^https?:\/\//.test(redirectUri)) {
    sendHtml(
      res,
      400,
      '<!doctype html><title>Error</title><h1>Something went wrong</h1><p>The redirect_uri is not valid for this App.</p>',
    );
    return true;
  }

  const state: Record<string, string> = q.get('state')
    ? { state: q.get('state')! }
    : {};
  const refuse = (error: string, description: string) => {
    redirect(
      res,
      withParams(redirectUri, {
        error,
        error_description: description,
        ...state,
      }),
    );
    return true;
  };

  if (q.get('response_type') !== 'code') {
    return refuse('unsupported_response_type', 'Only code is supported.');
  }
  if (!q.get('code_challenge')) {
    return refuse(
      'invalid_request',
      'Missing required parameter [code_challenge].',
    );
  }
  const method_ = q.get('code_challenge_method');
  if (method_ !== 'S256' && method_ !== 'plain') {
    return refuse(
      'invalid_request',
      'Value passed for the code_challenge_method was invalid.',
    );
  }
  const scopes = (q.get('scope') ?? '').split(/\s+/).filter(Boolean);
  if (scopes.length === 0) {
    return refuse('invalid_scope', 'Missing required parameter [scope].');
  }
  const unknown = scopes.filter((scope) => !KNOWN_SCOPES.includes(scope));
  if (unknown.length > 0) {
    return refuse('invalid_scope', `Invalid scope: ${unknown.join(' ')}`);
  }

  const account = social.signedIn('x');
  sendHtml(
    res,
    200,
    consentPage({
      vendor: 'X',
      accountName: account.name,
      accountHandle: xUsername(account.handle),
      scopes,
      action: DECISION_PATH,
      hidden: {
        client_id: CLIENT.clientId,
        redirect_uri: redirectUri,
        state: q.get('state') ?? '',
        code_challenge: q.get('code_challenge')!,
        code_challenge_method: method_,
      },
    }),
  );
  return true;
};

/** X usernames are up to 15 letters, digits and underscores. */
export function xUsername(handle: string) {
  return handle.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 15);
}

/** The consent form's own post (a sandbox path, not an X one). */
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

  const account = social.signedIn('x');
  const code = social.issueCode('x', account.id, form.getAll('scope'), {
    clientId: form.get('client_id') ?? '',
    redirectUri,
    codeChallenge: form.get('code_challenge') ?? undefined,
  });
  redirect(res, withParams(redirectUri, { code: code.value, ...state }));
  return true;
};

/** POST /2/oauth2/token — authorization_code and refresh_token grants. */
const tokenEndpoint: SocialRoute = ({
  url,
  method,
  req,
  body,
  res,
  social,
}) => {
  if (method !== 'POST' || url.pathname !== '/2/oauth2/token') return false;

  const form = formOf(body);
  const client = clientOf(req.headers.authorization, form);
  const confidentialOk =
    client.secret === null || client.secret === CLIENT.clientSecret;
  if (client.id !== CLIENT.clientId || !confidentialOk) {
    sendJson(
      res,
      401,
      tokenError('invalid_client', 'Missing valid authorization header'),
    );
    return true;
  }

  const grant = form.get('grant_type');

  if (grant === 'authorization_code') {
    const redeemed = social.redeemCode(
      form.get('code') ?? '',
      CLIENT.clientId,
      form.get('redirect_uri') ?? '',
    );
    const verifier = form.get('code_verifier') ?? '';
    const challenge = redeemed.ok ? redeemed.code.codeChallenge : undefined;
    if (
      !redeemed.ok ||
      !challenge ||
      !(pkceMatches(challenge, verifier) || challenge === verifier)
    ) {
      sendJson(res, 400, INVALID_TOKEN);
      return true;
    }
    const scopes = redeemed.code.scopes;
    const { access, refresh } = social.issueTokens(
      'x',
      redeemed.code.accountId,
      scopes,
      { ttlMs: ACCESS_TTL_S * 1000, refresh: scopes.includes(SCOPE.offline) },
    );
    if (refresh) refresh.expiresMs = social.now() + REFRESH_TTL_MS;
    sendJson(res, 200, {
      token_type: 'bearer',
      expires_in: ACCESS_TTL_S,
      access_token: access.value,
      scope: scopes.join(' '),
      ...(refresh ? { refresh_token: refresh.value } : {}),
    });
    return true;
  }

  if (grant === 'refresh_token') {
    const check = social.checkToken(form.get('refresh_token') ?? '');
    if (!check.ok || check.token.kind !== 'refresh') {
      sendJson(res, 400, INVALID_TOKEN);
      return true;
    }
    const old = check.token;
    old.revoked = true;
    const { access, refresh } = social.issueTokens(
      'x',
      old.accountId,
      old.scopes,
      { ttlMs: ACCESS_TTL_S * 1000 },
    );
    refresh!.expiresMs = social.now() + REFRESH_TTL_MS;
    sendJson(res, 200, {
      token_type: 'bearer',
      expires_in: ACCESS_TTL_S,
      access_token: access.value,
      scope: old.scopes.join(' '),
      refresh_token: refresh!.value,
    });
    return true;
  }

  sendJson(
    res,
    400,
    tokenError('unsupported_grant_type', `Invalid grant_type: ${grant ?? ''}`),
  );
  return true;
};

/** POST /2/oauth2/revoke — the token named, and no other. */
const revokeEndpoint: SocialRoute = ({
  url,
  method,
  req,
  body,
  res,
  social,
}) => {
  if (method !== 'POST' || url.pathname !== '/2/oauth2/revoke') return false;

  const form = formOf(body);
  const client = clientOf(req.headers.authorization, form);
  if (
    client.id !== CLIENT.clientId ||
    (client.secret !== null && client.secret !== CLIENT.clientSecret)
  ) {
    sendJson(
      res,
      401,
      tokenError('invalid_client', 'Missing valid authorization header'),
    );
    return true;
  }

  const found = social.token(form.get('token') ?? '');
  if (found) found.revoked = true;
  sendJson(res, 200, { revoked: true });
  return true;
};

export const xOAuthRoutes = [
  authorizePage,
  decision,
  tokenEndpoint,
  revokeEndpoint,
];
