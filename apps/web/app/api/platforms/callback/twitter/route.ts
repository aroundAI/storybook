import { NextRequest, NextResponse } from 'next/server';

import {
  TWITTER_OAUTH_CONFIG,
  TwitterOAuthState,
} from '@kit/publishing/oauth/twitter';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

interface TwitterOAuthMetadata {
  codeVerifier?: string;
}

/**
 * Twitter/X OAuth Callback Route
 * Handles the OAuth callback from Twitter, exchanges code for tokens with PKCE,
 * and stores the connection
 */
export async function GET(request: NextRequest) {
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

  if (error) {
    const errorDesc = request.nextUrl.searchParams.get('error_description');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=${encodeURIComponent(errorDesc || error)}`,
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=missing_params`,
    );
  }

  // Decode state
  let state: TwitterOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=invalid_state`,
    );
  }

  // Verify nonce and retrieve code verifier
  const { data: storedState, error: stateError } = await client
    .from('oauth_states')
    .select('*')
    .eq('nonce', state.nonce)
    .eq('user_id', user.id)
    .eq('platform', 'twitter')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=state_expired`,
    );
  }

  const metadata = storedState.metadata as TwitterOAuthMetadata | null;
  const codeVerifier = metadata?.codeVerifier;

  if (!codeVerifier) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=invalid_state`,
    );
  }

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=twitter_not_configured`,
    );
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

  const tokens = await tokenResponse.json();

  if (tokens.error || !tokens.access_token) {
    logger.error({ ...ctx, error: tokens.error }, 'Token exchange failed');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=${encodeURIComponent(tokens.error_description || tokens.error || 'token_exchange_failed')}`,
    );
  }

  // Validate expires_in for token expiration calculations
  if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
    logger.error({ ...ctx, tokens }, 'Invalid expires_in in token response');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=invalid_token_response`,
    );
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

  const userInfo = await userInfoResponse.json();
  const twitterUser = userInfo.data;

  if (!twitterUser) {
    logger.error({ ...ctx, error: userInfo }, 'Failed to get user info');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=no_user_info`,
    );
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
        scopes: tokens.scope?.split(' ') || TWITTER_OAUTH_CONFIG.scopes,
        metadata: {
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
    logger.error({ ...ctx, error: insertError }, 'Failed to store connection');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=storage_failed`,
    );
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
