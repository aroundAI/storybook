import { NextRequest, NextResponse } from 'next/server';

import { parseGrantedScopes } from '@kit/publishing/oauth/analytics-scopes';
import {
  TWITTER_OAUTH_CONFIG,
  TwitterOAuthState,
} from '@kit/publishing/oauth/twitter';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { accountIdFromUnverifiedState } from '~/lib/platforms/connect-failure';
import {
  CallbackFailure,
  catchConnectFailures,
  failConnect,
  vendorRefusal,
} from '~/lib/platforms/fail-connect';

interface TwitterOAuthMetadata {
  codeVerifier?: string;
}

/**
 * Twitter/X OAuth Callback Route
 * Handles the OAuth callback from Twitter, exchanges code for tokens with PKCE,
 * and stores the connection
 */
async function handleCallback(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.twitter.callback' };

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  // Every way of giving up goes through here: one log line, one landing page.
  const fail = (failure: CallbackFailure) =>
    failConnect({
      request,
      platform: 'twitter',
      accountId: accountIdFromUnverifiedState(stateParam),
      ...failure,
    });

  if (error) {
    return fail(vendorRefusal(error, request.nextUrl.searchParams));
  }

  if (!code || !stateParam) {
    return fail({ code: 'missing_params', branch: 'missing_params' });
  }

  // Decode state
  let state: TwitterOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());

    // Valid JSON is not yet a state: `null` parses, and has no nonce to read.
    if (typeof state?.nonce !== 'string') {
      throw new Error('Not an OAuth state');
    }
  } catch {
    return fail({ code: 'invalid_state', branch: 'state_unreadable' });
  }

  // Verify nonce and retrieve code verifier
  const { data: storedState, error: stateError } = await client
    .from('oauth_states')
    .select('id, nonce, user_id, platform, metadata, expires_at, created_at')
    .eq('nonce', state.nonce)
    .eq('user_id', user.id)
    .eq('platform', 'twitter')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return fail({
      code: 'state_expired',
      branch: 'state_not_found',
      cause: stateError,
    });
  }

  const metadata = storedState.metadata as TwitterOAuthMetadata | null;
  const codeVerifier = metadata?.codeVerifier;

  if (!codeVerifier) {
    return fail({ code: 'invalid_state', branch: 'code_verifier_missing' });
  }

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return fail({ code: 'not_configured', branch: 'credentials_missing' });
  }

  // Exchange code for tokens - Twitter requires Basic auth
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );

  const tokenResponse = await fetch(TWITTER_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${appUrl}/api/platforms/callback/twitter`,
      code_verifier: codeVerifier,
    }),
  });

  // Check HTTP status before parsing JSON to handle non-JSON error responses
  if (!tokenResponse.ok) {
    return fail({
      code: 'token_exchange_failed',
      branch: 'token_exchange_http',
      cause: await tokenResponse.text(),
      status: tokenResponse.status,
    });
  }

  const tokens = await tokenResponse.json();

  if (tokens.error || !tokens.access_token) {
    return fail({
      code: 'token_exchange_failed',
      branch: 'token_exchange',
      vendor: { error: tokens.error, description: tokens.error_description },
      status: tokenResponse.status,
    });
  }

  // Validate expires_in for token expiration calculations
  if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
    // Not `tokens`: that object is the access and refresh tokens.
    return fail({
      code: 'invalid_token_response',
      branch: 'expires_in_invalid',
    });
  }

  // Get user info
  const userInfoResponse = await fetch(
    `${TWITTER_OAUTH_CONFIG.userInfoUrl}?user.fields=profile_image_url`,
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    },
  );

  // Check HTTP status before parsing JSON
  if (!userInfoResponse.ok) {
    return fail({
      code: 'account_lookup_failed',
      branch: 'user_info_http',
      cause: await userInfoResponse.text(),
      status: userInfoResponse.status,
    });
  }

  const userInfo = await userInfoResponse.json();
  const twitterUser = userInfo.data;

  if (!twitterUser) {
    return fail({
      code: 'account_lookup_failed',
      branch: 'user_info_empty',
      cause: userInfo.errors?.[0],
    });
  }

  // Calculate expiration times
  const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  // Twitter refresh tokens expire in ~6 months if not used
  const refreshTokenExpiresAt = new Date(
    Date.now() + TWITTER_OAUTH_CONFIG.refreshTokenExpiry,
  );

  // Encrypt tokens before storage
  const encryptedAccessToken = await encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token)
    : null;

  // Store connection
  const { error: insertError } = await client
    .from('platform_connections')
    .upsert(
      {
        account_id: state.accountId,
        platform: 'twitter',
        platform_account_id: twitterUser.id,
        platform_account_name: twitterUser.username,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: accessTokenExpiresAt.toISOString(),
        scopes: parseGrantedScopes(tokens.scope),
        metadata: {
          scopes_granted_at: new Date().toISOString(),
          name: twitterUser.name,
          profile_image_url: twitterUser.profile_image_url,
          refresh_expires_at: refreshTokenExpiresAt.toISOString(),
        },
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'account_id,platform,platform_account_id',
      },
    );

  if (insertError) {
    return fail({
      code: 'storage_failed',
      branch: 'connection_upsert',
      cause: insertError,
    });
  }

  // Clean up used state after successful connection storage
  const { error: deleteError } = await client
    .from('oauth_states')
    .delete()
    .eq('nonce', state.nonce);

  if (deleteError) {
    // Log but don't fail - connection was already stored successfully
    logger.warn(
      { ...ctx, error: deleteError },
      'Failed to cleanup OAuth state',
    );
  }

  return NextResponse.redirect(
    `${state.returnUrl}?success=twitter_connected&username=${encodeURIComponent(twitterUser.username || '')}`,
  );
}

export const GET = catchConnectFailures('twitter', handleCallback);
