import { NextRequest, NextResponse } from 'next/server';

import {
  LINKEDIN_OAUTH_CONFIG,
  LinkedInOAuthState,
} from '@kit/publishing/oauth/linkedin';
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

/**
 * LinkedIn OAuth Callback Route
 * Handles the OAuth callback from LinkedIn, exchanges code for tokens,
 * and stores the connection
 */
async function handleCallback(request: NextRequest) {
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

  // Every way of giving up goes through here: one log line, one landing page.
  const fail = (failure: CallbackFailure) =>
    failConnect({
      request,
      platform: 'linkedin',
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
  let state: LinkedInOAuthState;
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
    .eq('platform', 'linkedin')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return fail({
      code: 'state_expired',
      branch: 'state_not_found',
      cause: stateError,
    });
  }

  const credentials = await getOAuthAppCredentials('linkedin');

  if (!credentials) {
    return fail({ code: 'not_configured', branch: 'credentials_missing' });
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: `${appUrl}/api/platforms/callback/linkedin`,
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

  // Validate expires_in for token expiration calculation
  if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
    // Not `tokens`: that object is the access and refresh tokens.
    return fail({
      code: 'invalid_token_response',
      branch: 'expires_in_invalid',
    });
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
      return fail({ code: 'account_lookup_failed', branch: 'profile_empty' });
    }
  } catch (profileError) {
    return fail({
      code: 'account_lookup_failed',
      branch: 'profile_fetch',
      cause: profileError,
    });
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
  const { error: insertError } = await storePlatformConnections(client, [
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
    `${state.returnUrl}?success=linkedin_connected&profile=${encodeURIComponent(profile.name || '')}`,
  );
}

export const GET = catchConnectFailures('linkedin', handleCallback);
