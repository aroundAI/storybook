import { sendJson } from '../../../http';
import { SANDBOX_CLIENTS } from '../../credentials';
import { mediaUrl } from '../../media';
import {
  consentPage,
  formOf,
  redirect,
  sendHtml,
  withParams,
} from '../../oauth';
import type { SocialRoute } from '../../server';
import { graphError, graphPath, metaAuthorize } from './errors';

/**
 * Facebook Login, as the app's Meta connect flow uses it
 * (`apps/web/app/api/platforms/callback/meta/route.ts`):
 *
 * 1. the dialog at `/{version}/dialog/oauth` (a consent page here);
 * 2. `GET /{version}/oauth/access_token` with the code — a short-lived user
 *    token — then again with `grant_type=fb_exchange_token` for a
 *    long-lived one (about 60 days; documented in the field index,
 *    `meta/oauth-token`);
 * 3. `GET /{version}/me/accounts` — the user's Pages, each with its own
 *    Page token and linked Instagram account (`facebook/user-accounts`);
 * 4. `GET /{version}/me/permissions` — what was actually granted, which can
 *    be less than the dialog asked for (`facebook/user-permissions`).
 *
 * One Page and one Instagram business account per sandbox, linked, as the
 * app expects of a creator it serves.
 */

const CLIENT = SANDBOX_CLIENTS.meta;
const SHORT_TTL_S = 3_600;
/** The long-lived figure Meta's own example shows. */
export const LONG_TTL_S = 5_183_944;
const DECISION_PATH = '/sandbox/meta/dialog-decision';

/** GET /{version}/dialog/oauth — the consent screen. */
const dialog: SocialRoute = ({ url, method, res, social }) => {
  if (method !== 'GET' || graphPath(url.pathname) !== '/dialog/oauth') {
    return false;
  }

  const q = url.searchParams;
  const redirectUri = q.get('redirect_uri') ?? '';
  if (
    q.get('client_id') !== CLIENT.clientId ||
    !/^https?:\/\//.test(redirectUri)
  ) {
    sendHtml(
      res,
      400,
      '<!doctype html><title>Error</title><h1>Invalid App ID</h1><p>The provided app ID does not look like a valid app ID.</p>',
    );
    return true;
  }

  const page = social.signedIn('facebook');
  sendHtml(
    res,
    200,
    consentPage({
      vendor: 'Facebook',
      accountName: page.name,
      accountHandle: page.handle,
      // Meta separates scopes with commas.
      scopes: (q.get('scope') ?? '').split(/[,\s]+/).filter(Boolean),
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

/** The consent form's own post (a sandbox path, not a Meta one). */
const decision: SocialRoute = ({ url, method, body, res, social }) => {
  if (method !== 'POST' || url.pathname !== DECISION_PATH) return false;

  const form = formOf(body);
  const redirectUri = form.get('redirect_uri') ?? '';
  const state = form.get('state') ?? '';
  const stateParam: Record<string, string> = state ? { state } : {};

  if (form.get('decision') !== 'allow') {
    // Meta's documented cancel: error=access_denied&error_reason=user_denied.
    redirect(
      res,
      withParams(redirectUri, {
        error: 'access_denied',
        error_reason: 'user_denied',
        error_description: 'Permissions error',
        ...stateParam,
      }),
    );
    return true;
  }

  const page = social.signedIn('facebook');
  const code = social.issueCode('facebook', page.id, form.getAll('scope'), {
    clientId: form.get('client_id') ?? '',
    redirectUri,
  });
  redirect(res, withParams(redirectUri, { code: code.value, ...stateParam }));
  return true;
};

/** GET /{version}/oauth/access_token — the code, or fb_exchange_token. */
const accessToken: SocialRoute = ({ url, method, res, social }) => {
  if (method !== 'GET' || graphPath(url.pathname) !== '/oauth/access_token') {
    return false;
  }

  const q = url.searchParams;
  if (
    q.get('client_id') !== CLIENT.clientId ||
    q.get('client_secret') !== CLIENT.clientSecret
  ) {
    sendJson(
      res,
      400,
      graphError(101, 'Error validating application. Invalid application ID.'),
    );
    return true;
  }

  if (q.get('grant_type') === 'fb_exchange_token') {
    const found = social.checkToken(q.get('fb_exchange_token') ?? '');
    if (!found.ok) {
      sendJson(
        res,
        400,
        graphError(
          190,
          'Invalid OAuth access token - Cannot parse access token',
        ),
      );
      return true;
    }
    const { access } = social.issueTokens(
      'facebook',
      found.token.accountId,
      found.token.scopes,
      { ttlMs: LONG_TTL_S * 1000, refresh: false },
    );
    sendJson(res, 200, {
      access_token: access.value,
      token_type: 'bearer',
      expires_in: LONG_TTL_S,
    });
    return true;
  }

  const redeemed = social.redeemCode(
    q.get('code') ?? '',
    CLIENT.clientId,
    q.get('redirect_uri') ?? '',
  );
  if (!redeemed.ok) {
    sendJson(
      res,
      400,
      graphError(
        100,
        redeemed.reason === 'redirect'
          ? 'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request'
          : 'This authorization code has been used.',
        'OAuthException',
        36007,
      ),
    );
    return true;
  }

  const { access } = social.issueTokens(
    'facebook',
    redeemed.code.accountId,
    redeemed.code.scopes,
    { ttlMs: SHORT_TTL_S * 1000, refresh: false },
  );
  sendJson(res, 200, {
    access_token: access.value,
    token_type: 'bearer',
    expires_in: SHORT_TTL_S,
  });
  return true;
};

/** GET /{version}/me/accounts — the Page, its token and its Instagram account. */
const meAccounts: SocialRoute = ({ url, method, req, res, social, self }) => {
  if (method !== 'GET' || graphPath(url.pathname) !== '/me/accounts') {
    return false;
  }

  const user = metaAuthorize(url, req, res, social, ['pages_show_list']);
  if (!user) return true;

  const page = social.signedIn('facebook');
  const instagram = social.signedIn('instagram');

  // The Page token: what the app uses for every Instagram call. Page tokens
  // from a long-lived user token do not expire.
  const { access: pageToken } = social.issueTokens(
    'facebook',
    page.id,
    user.scopes,
    { ttlMs: 10 * 365 * 24 * 3_600_000, refresh: false },
  );

  sendJson(res, 200, {
    data: [
      {
        id: page.id,
        name: page.name,
        access_token: pageToken.value,
        category: 'Video Creator',
        picture: {
          data: { url: mediaUrl(self, 'avatar', page.id, page.name) },
        },
        instagram_business_account: { id: instagram.id },
      },
    ],
    paging: { cursors: { before: 'QVFIUjBl', after: 'QVFIUjBl' } },
  });
  return true;
};

/** GET /{version}/me/permissions — what this token was granted. */
const mePermissions: SocialRoute = ({ url, method, req, res, social }) => {
  if (method !== 'GET' || graphPath(url.pathname) !== '/me/permissions') {
    return false;
  }

  const token = metaAuthorize(url, req, res, social);
  if (!token) return true;

  sendJson(res, 200, {
    data: token.scopes.map((permission) => ({
      permission,
      status: 'granted',
    })),
  });
  return true;
};

export const metaOAuthRoutes: readonly SocialRoute[] = [
  dialog,
  decision,
  accessToken,
  meAccounts,
  mePermissions,
];
