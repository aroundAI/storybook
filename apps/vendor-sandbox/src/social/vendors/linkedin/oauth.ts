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
import { KNOWN_SCOPES } from './errors';

/**
 * LinkedIn's 3-legged OAuth
 * (https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow):
 * the authorize page, and the token endpoint's code and refresh grants.
 *
 * Documented: 60-day access tokens, 30-minute codes, a token request with a
 * different scope set invalidates the member's earlier access tokens, and
 * refresh tokens ("programmatic refresh") only for approved partners. The
 * sandbox plays a partner that has it, because the app stores and refreshes
 * with one; the refresh token keeps its value and its remaining lifetime,
 * as the programmatic-refresh page describes (recorded as inferred).
 * LinkedIn documents no revoke call the app could use, so none is served
 * (KB-25).
 */

const CLIENT = SANDBOX_CLIENTS.linkedin;
const ACCESS_TTL_S = 5_184_000;
const REFRESH_TTL_S = 31_536_000;
const DECISION_PATH = '/oauth/v2/authorization/sandbox-decision';
const GRANTS = 'linkedin-grants';

interface Grant {
  accountId: string;
  scopes: string[];
  accessTokens: string[];
}

function tokenError(error: string, description: string) {
  return { error, error_description: description };
}

/** GET /oauth/v2/authorization — the consent screen. */
const authorizePage: SocialRoute = ({ url, method, res, social }) => {
  if (method !== 'GET' || url.pathname !== '/oauth/v2/authorization')
    return false;

  const q = url.searchParams;
  const refuse = (message: string) => {
    sendHtml(
      res,
      401,
      `<!doctype html><title>LinkedIn</title><h1>Bummer, something went wrong.</h1><p>${message}</p>`,
    );
    return true;
  };
  if (q.get('client_id') !== CLIENT.clientId)
    return refuse('Client_id doesn’t match');
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!/^https?:\/\//.test(redirectUri))
    return refuse('Redirect_uri doesn’t match');
  const scopes = (q.get('scope') ?? '').split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((s) => !KNOWN_SCOPES.includes(s)))
    return refuse('Invalid scope');

  const state: Record<string, string> = q.get('state')
    ? { state: q.get('state')! }
    : {};
  if (q.get('response_type') !== 'code') {
    redirect(
      res,
      withParams(redirectUri, {
        error: 'unsupported_response_type',
        error_description: 'The response type must be code.',
        ...state,
      }),
    );
    return true;
  }

  const account = social.signedIn('linkedin');
  sendHtml(
    res,
    200,
    consentPage({
      vendor: 'LinkedIn',
      accountName: account.name,
      accountHandle: account.name.toLowerCase().replace(/\s+/g, '-'),
      scopes,
      action: DECISION_PATH,
      hidden: {
        client_id: CLIENT.clientId,
        redirect_uri: redirectUri,
        state: q.get('state') ?? '',
      },
    }),
  );
  return true;
};

/** The consent form's own post (a sandbox path, not a LinkedIn one). */
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
        error: 'user_cancelled_authorize',
        error_description: 'The user cancelled the authorization',
        ...state,
      }),
    );
    return true;
  }

  const account = social.signedIn('linkedin');
  const code = social.issueCode('linkedin', account.id, form.getAll('scope'), {
    clientId: form.get('client_id') ?? '',
    redirectUri,
  });
  redirect(res, withParams(redirectUri, { code: code.value, ...state }));
  return true;
};

const sameScopes = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s) => b.includes(s));

/** POST /oauth/v2/accessToken — authorization_code and refresh_token grants. */
const tokenEndpoint: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== '/oauth/v2/accessToken')
    return false;

  const form = formOf(body);
  for (const name of ['grant_type', 'client_id', 'client_secret']) {
    if (!form.get(name)) {
      sendJson(
        res,
        400,
        tokenError(
          'invalid_request',
          `A required parameter "${name}" is missing`,
        ),
      );
      return true;
    }
  }
  if (
    form.get('client_id') !== CLIENT.clientId ||
    form.get('client_secret') !== CLIENT.clientSecret
  ) {
    sendJson(
      res,
      401,
      tokenError('invalid_client', 'Client authentication failed'),
    );
    return true;
  }

  const grant = form.get('grant_type');

  if (grant === 'authorization_code') {
    for (const name of ['code', 'redirect_uri']) {
      if (!form.get(name)) {
        sendJson(
          res,
          400,
          tokenError(
            'invalid_request',
            `A required parameter "${name}" is missing`,
          ),
        );
        return true;
      }
    }
    const redeemed = social.redeemCode(
      form.get('code')!,
      CLIENT.clientId,
      form.get('redirect_uri')!,
    );
    if (!redeemed.ok) {
      if (redeemed.reason === 'unknown') {
        sendJson(
          res,
          401,
          tokenError(
            'invalid_request',
            'Unable to retrieve access token: authorization code not found',
          ),
        );
      } else {
        sendJson(
          res,
          400,
          tokenError(
            'invalid_redirect_uri',
            'Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code. Or authorization code expired. Or external member binding exists',
          ),
        );
      }
      return true;
    }
    const { accountId, scopes } = redeemed.code;
    const { access, refresh } = social.issueTokens(
      'linkedin',
      accountId,
      scopes,
      { ttlMs: ACCESS_TTL_S * 1000 },
    );
    refresh!.expiresMs = social.now() + REFRESH_TTL_S * 1000;

    // A token request with a different scope set invalidates the earlier
    // access tokens (the authorization-code-flow page's note).
    for (const earlier of social.list<Grant>(GRANTS)) {
      if (
        earlier.accountId === accountId &&
        !sameScopes(earlier.scopes, scopes)
      ) {
        for (const value of earlier.accessTokens) {
          const found = social.token(value);
          if (found) found.revoked = true;
        }
        earlier.accessTokens = [];
      }
    }
    const current = social
      .list<Grant>(GRANTS)
      .find((g) => g.accountId === accountId && sameScopes(g.scopes, scopes));
    if (current) current.accessTokens.push(access.value);
    else
      social.add<Grant>(GRANTS, {
        accountId,
        scopes: [...scopes],
        accessTokens: [access.value],
      });

    sendJson(res, 200, {
      access_token: access.value,
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh!.value,
      refresh_token_expires_in: REFRESH_TTL_S,
      scope: scopes.join(' '),
    });
    return true;
  }

  if (grant === 'refresh_token') {
    const check = social.checkToken(form.get('refresh_token') ?? '');
    if (!check.ok || check.token.kind !== 'refresh') {
      sendJson(
        res,
        400,
        tokenError('invalid_request', 'The provided refresh token is invalid'),
      );
      return true;
    }
    const held = check.token;
    const { access } = social.issueTokens(
      'linkedin',
      held.accountId,
      held.scopes,
      { ttlMs: ACCESS_TTL_S * 1000, refresh: false },
    );
    social
      .list<Grant>(GRANTS)
      .find(
        (g) =>
          g.accountId === held.accountId && sameScopes(g.scopes, held.scopes),
      )
      ?.accessTokens.push(access.value);
    sendJson(res, 200, {
      access_token: access.value,
      expires_in: ACCESS_TTL_S,
      refresh_token: held.value,
      refresh_token_expires_in: Math.max(
        0,
        Math.floor(((held.expiresMs ?? 0) - social.now()) / 1000),
      ),
      scope: held.scopes.join(' '),
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

export const linkedInOAuthRoutes = [authorizePage, decision, tokenEndpoint];
