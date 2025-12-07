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
  let state: YouTubeOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=invalid_state`,
    );
  }

  // Verify nonce
  // Note: Type assertions needed until database types are regenerated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: storedState, error: stateError } = await (client as any)
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

  // Clean up used state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).from('oauth_states').delete().eq('nonce', state.nonce);

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
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
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appUrl}/api/platforms/callback/youtube`,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    logger.error({ ...ctx, error: tokens.error }, 'Token exchange failed');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=${encodeURIComponent(tokens.error_description || tokens.error)}`,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (client as any)
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
        scopes: YOUTUBE_OAUTH_CONFIG.scopes,
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

  return NextResponse.redirect(
    `${state.returnUrl}?success=youtube_connected&channel=${encodeURIComponent(channel.snippet?.title || '')}`,
  );
}
