import { NextRequest, NextResponse } from 'next/server';

import { google } from 'googleapis';

import {
  YOUTUBE_OAUTH_CONFIG,
  YouTubeOAuthState,
} from '@kit/publishing/oauth/youtube';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * YouTube OAuth Callback Route
 * Handles the OAuth callback from Google, exchanges code for tokens,
 * and stores the connection
 */
export async function GET(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.youtube.callback' };

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';

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
  let state: YouTubeOAuthState;
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
    .eq('platform', 'youtube')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=state_expired`,
    );
  }

  // Note: State deletion moved to after successful connection storage
  // to allow retry on token exchange failure

  // Get OAuth credentials from database (account-scoped)
  const { getAccountOAuthApp } = await import('@kit/publishing/server');
  const oauthApp = await getAccountOAuthApp(state.accountId, 'youtube');

  if (!oauthApp) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=youtube_not_configured`,
    );
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: oauthApp.clientId,
      client_secret: oauthApp.clientSecret,
      redirect_uri: `${appUrl}/api/platforms/callback/youtube`,
      grant_type: 'authorization_code',
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

  // Get channel info using googleapis
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokens.access_token });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  let channel;
  try {
    const channelResponse = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    channel = channelResponse.data.items?.[0];
    if (!channel) {
      return NextResponse.redirect(
        `${appUrl}/settings/platforms?error=no_channel`,
      );
    }
  } catch (channelError) {
    logger.error({ ...ctx, error: channelError }, 'Failed to get channel');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=channel_fetch_failed`,
    );
  }

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
        platform: 'youtube',
        platform_account_id: channel.id,
        platform_account_name: channel.snippet?.title,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString(),
        scopes: [...YOUTUBE_OAUTH_CONFIG.scopes],
        metadata: {
          thumbnail_url: channel.snippet?.thumbnails?.default?.url,
          subscriber_count: channel.statistics?.subscriberCount,
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
    `${state.returnUrl}?success=youtube_connected&channel=${encodeURIComponent(channel.snippet?.title || '')}`,
  );
}
