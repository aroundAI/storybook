import { NextRequest, NextResponse } from 'next/server';

import {
  LINKEDIN_OAUTH_CONFIG,
  LinkedInOAuthState,
} from '@kit/publishing/oauth/linkedin';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * LinkedIn OAuth Callback Route
 * Handles the OAuth callback from LinkedIn, exchanges code for tokens,
 * and stores the connection
 */
export async function GET(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.linkedin.callback' };

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

  // Decode and validate state
  let state: LinkedInOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=invalid_state`,
    );
  }

  // Verify nonce
  const { data: storedState, error: stateError } = await client
    .from('oauth_states')
    .select('*')
    .eq('nonce', state.nonce)
    .eq('user_id', user.id)
    .eq('platform', 'linkedin')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=state_expired`,
    );
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=linkedin_not_configured`,
    );
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appUrl}/api/platforms/callback/linkedin`,
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error || !tokens.access_token) {
    logger.error({ ...ctx, error: tokens.error }, 'Token exchange failed');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=${encodeURIComponent(tokens.error_description || tokens.error || 'token_exchange_failed')}`,
    );
  }

  // Validate expires_in for token expiration calculation
  if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
    logger.error({ ...ctx, tokens }, 'Invalid expires_in in token response');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=invalid_token_response`,
    );
  }

  // Get user profile using OpenID Connect userinfo endpoint
  let profile;
  try {
    const profileResponse = await fetch(LINKEDIN_OAUTH_CONFIG.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error('Failed to fetch profile');
    }

    profile = await profileResponse.json();

    if (!profile.sub) {
      return NextResponse.redirect(
        `${appUrl}/settings/platforms?error=no_profile`,
      );
    }
  } catch (profileError) {
    logger.error({ ...ctx, error: profileError }, 'Failed to get profile');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=profile_fetch_failed`,
    );
  }

  // Encrypt tokens before storage
  const encryptedAccessToken = await encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token)
    : null;

  // Determine scopes based on what was requested
  const scopes = state.isCompanyPage
    ? LINKEDIN_OAUTH_CONFIG.scopes.company
    : LINKEDIN_OAUTH_CONFIG.scopes.personal;

  // Store connection
  const { error: insertError } = await client
    .from('platform_connections')
    .upsert(
      {
        account_id: state.accountId,
        platform: 'linkedin',
        platform_account_id: `urn:li:person:${profile.sub}`,
        platform_account_name: profile.name,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString(),
        scopes: [...scopes],
        metadata: {
          picture: profile.picture,
          email: profile.email,
          isCompanyPage: state.isCompanyPage || false,
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
    `${state.returnUrl}?success=linkedin_connected&profile=${encodeURIComponent(profile.name || '')}`,
  );
}
