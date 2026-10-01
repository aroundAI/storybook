import { NextRequest, NextResponse } from 'next/server';

import { parseMetaGrantedPermissions } from '@kit/publishing/oauth/analytics-scopes';
import type { MetaOAuthState } from '@kit/publishing/oauth/meta';
import { getOAuthAppCredentials } from '@kit/publishing/server/oauth-app-credentials';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { metaFetch } from '@kit/shared/vendors';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { accountIdFromUnverifiedState } from '~/lib/platforms/connect-failure';
import { connectedLanding } from '~/lib/platforms/connect-landing';
import {
  CallbackFailure,
  catchConnectFailures,
  failConnect,
  vendorRefusal,
} from '~/lib/platforms/fail-connect';
import { storePlatformConnections } from '~/lib/platforms/store-connection';

interface FacebookPageResponse {
  id: string;
  name: string;
  access_token: string;
  category: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string };
}

interface InstagramAccountResponse {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

/**
 * Meta OAuth Callback Route
 * Handles the OAuth callback from Facebook, exchanges code for tokens,
 * fetches Pages and Instagram accounts, and stores connections
 */
async function handleCallback(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.meta.callback' };

  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  const code = request.nextUrl.searchParams.get('code');
  const stateParam = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';

  // Every way of giving up goes through here: one log line, one landing page.
  const fail = (failure: CallbackFailure) =>
    failConnect({
      request,
      platform: 'meta',
      accountId: accountIdFromUnverifiedState(stateParam),
      ...failure,
    });

  if (error) {
    return fail(vendorRefusal(error, request.nextUrl.searchParams));
  }

  if (!code || !stateParam) {
    return fail({ code: 'missing_params', branch: 'missing_params' });
  }

  // Decode and validate state
  let state: MetaOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());

    // Valid JSON is not yet a state: `null` parses, and has no nonce to read.
    if (typeof state?.nonce !== 'string') {
      throw new Error('Not an OAuth state');
    }
  } catch {
    return fail({ code: 'invalid_state', branch: 'state_unreadable' });
  }

  // Verify nonce
  const { data: storedState, error: stateError } = await client
    .from('oauth_states')
    .select('id, nonce, user_id, platform, metadata, expires_at, created_at')
    .eq('nonce', state.nonce)
    .eq('user_id', user.id)
    .eq('platform', 'meta')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return fail({
      code: 'state_expired',
      branch: 'state_not_found',
      cause: stateError,
    });
  }

  // Get global OAuth credentials (configured by super admin)
  const credentials = await getOAuthAppCredentials('meta');

  if (!credentials) {
    return fail({ code: 'not_configured', branch: 'credentials_missing' });
  }

  // Exchange code for short-lived token
  const tokenQuery = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: `${appUrl}/api/platforms/callback/meta`,
    code,
  });

  const tokenResponse = await metaFetch(`/oauth/access_token?${tokenQuery}`);
  const shortLivedToken = await tokenResponse.json();

  if (shortLivedToken.error || !shortLivedToken.access_token) {
    return fail({
      code: 'token_exchange_failed',
      branch: 'token_exchange',
      vendor: {
        error: shortLivedToken.error?.type,
        description: shortLivedToken.error?.message,
      },
      status: tokenResponse.status,
    });
  }

  // Exchange for long-lived token
  const longLivedQuery = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    fb_exchange_token: shortLivedToken.access_token,
  });

  const longLivedResponse = await metaFetch(
    `/oauth/access_token?${longLivedQuery}`,
  );
  const longLivedToken = await longLivedResponse.json();

  if (longLivedToken.error || !longLivedToken.access_token) {
    return fail({
      code: 'token_exchange_failed',
      branch: 'long_lived_token_exchange',
      vendor: {
        error: longLivedToken.error?.type,
        description: longLivedToken.error?.message,
      },
      status: longLivedResponse.status,
    });
  }

  const userAccessToken = longLivedToken.access_token;
  const expiresAt = new Date(
    Date.now() + (longLivedToken.expires_in || 5184000) * 1000,
  );

  // Get user's Pages with Instagram accounts
  const pagesResponse = await metaFetch(
    '/me/accounts?fields=id,name,access_token,category,picture,instagram_business_account',
    { token: userAccessToken },
  );
  const pagesData = await pagesResponse.json();

  if (pagesData.error) {
    return fail({
      code: 'account_lookup_failed',
      branch: 'pages_fetch',
      cause: pagesData.error,
      status: pagesResponse.status,
    });
  }

  const pages: FacebookPageResponse[] = pagesData.data || [];

  if (pages.length === 0) {
    return fail({ code: 'no_pages_found', branch: 'no_pages_found' });
  }

  const encryptedUserToken = await encrypt(userAccessToken);

  // What the person granted, which can be less than the dialog asked for —
  // `/me/permissions` lists declined and expired permissions beside granted
  // ones. `[]` when the lookup fails, which reads as "no recorded grant"
  // rather than as a grant of everything we asked for.
  const grantedScopes = await metaFetch('/me/permissions', {
    token: userAccessToken,
  })
    .then((response) => response.json())
    .then(parseMetaGrantedPermissions)
    .catch(() => []);

  if (grantedScopes.length === 0) {
    logger.warn(ctx, 'Could not read granted permissions');
  }

  const scopesGrantedAt = new Date().toISOString();

  // Store connections for each page and associated Instagram
  const pageConnectionResults = await Promise.all(
    pages.map(async (page) => {
      const pageConnections: Array<{
        account_id: string;
        platform: string;
        platform_account_id: string;
        platform_account_name: string;
        access_token_encrypted: string;
        refresh_token_encrypted: string;
        token_expires_at: string;
        scopes: string[];
        is_active: boolean;
        metadata: { [key: string]: string | number | boolean | null };
        updated_at: string;
      }> = [];

      // Store Facebook Page connection
      if (state.platforms.includes('facebook')) {
        const encryptedPageToken = await encrypt(page.access_token);
        pageConnections.push({
          account_id: state.accountId,
          platform: 'facebook',
          platform_account_id: page.id,
          platform_account_name: page.name,
          access_token_encrypted: encryptedPageToken, // Page access token (never expires)
          refresh_token_encrypted: encryptedUserToken, // User token for refresh
          token_expires_at: expiresAt.toISOString(),
          scopes: grantedScopes,
          is_active: true,
          metadata: {
            scopes_granted_at: scopesGrantedAt,
            category: page.category,
            picture_url: page.picture?.data?.url ?? null,
            user_token_expires_at: expiresAt.toISOString(),
          },
          updated_at: new Date().toISOString(),
        });
      }

      // Store Instagram Business connection if linked
      if (
        state.platforms.includes('instagram') &&
        page.instagram_business_account
      ) {
        const igAccountId = page.instagram_business_account.id;

        // Get Instagram account details
        try {
          const igResponse = await metaFetch(
            `/${igAccountId}?fields=username,name,profile_picture_url,followers_count`,
            { token: page.access_token },
          );
          const igAccount: InstagramAccountResponse = await igResponse.json();

          if (igAccount.id) {
            const encryptedPageToken = await encrypt(page.access_token);
            pageConnections.push({
              account_id: state.accountId,
              platform: 'instagram',
              platform_account_id: igAccountId,
              platform_account_name:
                igAccount.username || igAccount.name || igAccountId,
              access_token_encrypted: encryptedPageToken, // Use Page token for Instagram API
              refresh_token_encrypted: encryptedUserToken, // User token for refresh
              token_expires_at: expiresAt.toISOString(),
              scopes: grantedScopes,
              is_active: true,
              metadata: {
                scopes_granted_at: scopesGrantedAt,
                linked_page_id: page.id,
                profile_picture_url: igAccount.profile_picture_url ?? null,
                followers_count: igAccount.followers_count ?? null,
                user_token_expires_at: expiresAt.toISOString(),
              },
              updated_at: new Date().toISOString(),
            });
          } else {
            logger.warn(
              { ...ctx, pageId: page.id },
              'Failed to fetch Instagram account details',
            );
          }
        } catch (error) {
          logger.error(
            { ...ctx, pageId: page.id, error },
            'Error processing Instagram account',
          );
        }
      }

      return pageConnections;
    }),
  );

  const connections = pageConnectionResults.flat();

  // Upsert all connections
  if (connections.length > 0) {
    const { error: insertError } = await storePlatformConnections(
      client,
      connections,
    );

    if (insertError) {
      return fail({
        code: 'storage_failed',
        branch: insertError.branch,
        cause: insertError.cause,
      });
    }
  }

  // Clean up used state after successful connection storage
  const { error: deleteError } = await client
    .from('oauth_states')
    .delete()
    .eq('nonce', state.nonce);

  if (deleteError) {
    logger.warn(
      { ...ctx, error: deleteError },
      'Failed to cleanup OAuth state',
    );
  }

  const connectedCount = connections.length;
  const platformNames = connections
    .map((c) => c.platform_account_name)
    .join(', ');

  return connectedLanding(request, client, state.accountId, {
    success: 'meta_connected',
    count: String(connectedCount),
    accounts: platformNames,
  });
}

export const GET = catchConnectFailures('meta', handleCallback);
