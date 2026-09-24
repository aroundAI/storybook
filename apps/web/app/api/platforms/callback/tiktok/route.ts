import { NextRequest, NextResponse } from 'next/server';

import { parseGrantedScopes } from '@kit/publishing/oauth/analytics-scopes';
import {
  TIKTOK_OAUTH_CONFIG,
  TikTokOAuthState,
} from '@kit/publishing/oauth/tiktok';
import { getOAuthAppCredentials } from '@kit/publishing/server/oauth-app-credentials';
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
import { storePlatformConnections } from '~/lib/platforms/store-connection';

interface TikTokOAuthMetadata {
  codeVerifier?: string;
}

/**
 * TikTok OAuth Callback Route
 * Handles the OAuth callback from TikTok, exchanges code for tokens with PKCE,
 * and stores the connection
 */
async function handleCallback(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.tiktok.callback' };

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
      platform: 'tiktok',
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
  let state: TikTokOAuthState;
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
    .eq('platform', 'tiktok')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return fail({
      code: 'state_expired',
      branch: 'state_not_found',
      cause: stateError,
    });
  }

  const metadata = storedState.metadata as TikTokOAuthMetadata | null;
  const codeVerifier = metadata?.codeVerifier;

  if (!codeVerifier) {
    return fail({ code: 'invalid_state', branch: 'code_verifier_missing' });
  }

  // Note: State deletion moved to after successful connection storage
  // to allow retry on token exchange failure

  const credentials = await getOAuthAppCredentials('tiktok');

  if (!credentials) {
    return fail({ code: 'not_configured', branch: 'credentials_missing' });
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(TIKTOK_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${appUrl}/api/platforms/callback/tiktok`,
      code_verifier: codeVerifier,
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error || !tokens.access_token) {
    return fail({
      code: 'token_exchange_failed',
      branch: 'token_exchange',
      vendor: { error: tokens.error, description: tokens.error_description },
      status: tokenResponse.status,
    });
  }

  // Validate expires_in and refresh_expires_in for token expiration calculations
  if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
    // Not `tokens`: that object is the access and refresh tokens.
    return fail({
      code: 'invalid_token_response',
      branch: 'expires_in_invalid',
    });
  }

  if (
    typeof tokens.refresh_expires_in !== 'number' ||
    tokens.refresh_expires_in <= 0
  ) {
    return fail({
      code: 'invalid_token_response',
      branch: 'refresh_expires_in_invalid',
    });
  }

  // Get user info
  const userInfoResponse = await fetch(
    `${TIKTOK_OAUTH_CONFIG.userInfoUrl}?fields=open_id,union_id,avatar_url,display_name`,
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    },
  );

  const userInfo = await userInfoResponse.json();
  const tiktokUser = userInfo.data?.user;

  if (!tiktokUser) {
    return fail({
      code: 'account_lookup_failed',
      branch: 'user_info_empty',
      cause: userInfo.error,
      status: userInfoResponse.status,
    });
  }

  // Calculate expiration times
  const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const refreshTokenExpiresAt = new Date(
    Date.now() + tokens.refresh_expires_in * 1000,
  );

  // Encrypt tokens before storage
  const encryptedAccessToken = await encrypt(tokens.access_token);
  const encryptedRefreshToken = await encrypt(tokens.refresh_token);

  // Store connection
  const { error: insertError } = await storePlatformConnections(client, [
    {
      account_id: state.accountId,
      platform: 'tiktok',
      platform_account_id: tiktokUser.open_id,
      platform_account_name: tiktokUser.display_name,
      access_token_encrypted: encryptedAccessToken,
      refresh_token_encrypted: encryptedRefreshToken,
      token_expires_at: accessTokenExpiresAt.toISOString(),
      // No fallback to the scopes we requested: that records a grant
      // nobody confirmed, and the analytics gate would believe it.
      scopes: parseGrantedScopes(tokens.scope),
      metadata: {
        scopes_granted_at: new Date().toISOString(),
        union_id: tiktokUser.union_id,
        avatar_url: tiktokUser.avatar_url,
        refresh_expires_at: refreshTokenExpiresAt.toISOString(),
      },
      is_active: true,
      updated_at: new Date().toISOString(),
    },
  ]);

  if (insertError) {
    return fail({
      code: 'storage_failed',
      branch: insertError.branch,
      cause: insertError.cause,
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
    `${state.returnUrl}?success=tiktok_connected&username=${encodeURIComponent(tiktokUser.display_name || '')}`,
  );
}

export const GET = catchConnectFailures('tiktok', handleCallback);
