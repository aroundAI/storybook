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

/**
 * Google OAuth 2.0 for web servers
 * (https://developers.google.com/identity/protocols/oauth2/web-server):
 * the authorize page, the token endpoint (code and refresh grants) and
 * revoke. One client is accepted — the sandbox's own.
 */

const CLIENT = SANDBOX_CLIENTS.youtube;
const ACCESS_TTL_S = 3599;
const DECISION_PATH = '/o/oauth2/v2/auth/sandbox-decision';

function tokenError(error: string, description: string) {
  return { error, error_description: description };
}

/** GET /o/oauth2/v2/auth — the consent screen. */
const authorizePage: SocialRoute = ({ url, method, res, social }) => {
  if (method !== 'GET' || url.pathname !== '/o/oauth2/v2/auth') return false;

  const q = url.searchParams;
  if (q.get('client_id') !== CLIENT.clientId) {
    sendHtml(
      res,
      401,
      '<!doctype html><title>Error 401: invalid_client</title><h1>Access blocked: authorisation error</h1><p>Error 401: invalid_client — the OAuth client was not found.</p>',
    );
    return true;
  }
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!/^https?:\/\//.test(redirectUri)) {
    sendHtml(
      res,
      400,
      '<!doctype html><title>Error 400: redirect_uri_mismatch</title><h1>Error 400: redirect_uri_mismatch</h1>',
    );
    return true;
  }
  if (q.get('response_type') !== 'code') {
    redirect(
      res,
      withParams(redirectUri, {
        error: 'unsupported_response_type',
        ...(q.get('state') ? { state: q.get('state')! } : {}),
      }),
    );
    return true;
  }

  const account = social.signedIn('youtube');
  sendHtml(
    res,
    200,
    consentPage({
      vendor: 'Google',
      accountName: account.name,
      accountHandle: account.handle,
      scopes: (q.get('scope') ?? '').split(/\s+/).filter(Boolean),
      action: DECISION_PATH,
      hidden: {
        client_id: CLIENT.clientId,
        redirect_uri: redirectUri,
        state: q.get('state') ?? '',
        access_type: q.get('access_type') ?? 'online',
      },
    }),
  );
  return true;
};

/** The consent form's own post (a sandbox path, not a Google one). */
const decision: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== DECISION_PATH) return false;

  const form = formOf(body);
  const redirectUri = form.get('redirect_uri') ?? '';
  const state = form.get('state') ?? '';
  const stateParam: Record<string, string> = state ? { state } : {};

  if (form.get('decision') !== 'allow') {
    redirect(
      res,
      withParams(redirectUri, { error: 'access_denied', ...stateParam }),
    );
    return true;
  }

  const account = social.signedIn('youtube');
  const code = social.issueCode('youtube', account.id, form.getAll('scope'), {
    clientId: form.get('client_id') ?? '',
    redirectUri,
  });
  redirect(res, withParams(redirectUri, { code: code.value, ...stateParam }));
  return true;
};

/** POST /token — authorization_code and refresh_token grants. */
const tokenEndpoint: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== '/token') return false;

  const form = formOf(body);
  if (
    form.get('client_id') !== CLIENT.clientId ||
    form.get('client_secret') !== CLIENT.clientSecret
  ) {
    sendJson(res, 401, tokenError('invalid_client', 'Unauthorized'));
    return true;
  }

  const grant = form.get('grant_type');

  if (grant === 'authorization_code') {
    const redeemed = social.redeemCode(
      form.get('code') ?? '',
      CLIENT.clientId,
      form.get('redirect_uri') ?? '',
    );
    if (!redeemed.ok) {
      sendJson(
        res,
        400,
        redeemed.reason === 'redirect'
          ? tokenError('redirect_uri_mismatch', 'Bad Request')
          : tokenError('invalid_grant', 'Bad Request'),
      );
      return true;
    }
    const { access, refresh } = social.issueTokens(
      'youtube',
      redeemed.code.accountId,
      redeemed.code.scopes,
      { ttlMs: ACCESS_TTL_S * 1000 },
    );
    sendJson(res, 200, {
      access_token: access.value,
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh!.value,
      scope: access.scopes.join(' '),
      token_type: 'Bearer',
    });
    return true;
  }

  if (grant === 'refresh_token') {
    const found = social.token(form.get('refresh_token') ?? '');
    if (!found || found.kind !== 'refresh' || found.revoked) {
      sendJson(
        res,
        400,
        tokenError('invalid_grant', 'Token has been expired or revoked.'),
      );
      return true;
    }
    const { access } = social.issueTokens(
      'youtube',
      found.accountId,
      found.scopes,
      {
        ttlMs: ACCESS_TTL_S * 1000,
        refresh: false,
      },
    );
    // A refresh grant returns a new access token, not a new refresh token.
    sendJson(res, 200, {
      access_token: access.value,
      expires_in: ACCESS_TTL_S,
      scope: access.scopes.join(' '),
      token_type: 'Bearer',
    });
    return true;
  }

  sendJson(
    res,
    400,
    tokenError(
      'unsupported_grant_type',
      'Invalid grant_type: ' + (grant ?? ''),
    ),
  );
  return true;
};

/** POST /revoke?token=… (or `token` in a form body). */
const revokeEndpoint: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== '/revoke') return false;

  const value =
    url.searchParams.get('token') ?? formOf(body).get('token') ?? '';
  const found = social.token(value);
  if (!found || found.revoked) {
    sendJson(res, 400, tokenError('invalid_token', 'Token expired or revoked'));
    return true;
  }
  social.revoke(value);
  sendJson(res, 200, {});
  return true;
};

export const googleOAuthRoutes = [
  authorizePage,
  decision,
  tokenEndpoint,
  revokeEndpoint,
];
