import { NextRequest, NextResponse } from 'next/server';

import { youtube as youtubeApi } from '@googleapis/youtube';
import { OAuth2Client } from 'google-auth-library';

import {
  YOUTUBE_OAUTH_CONFIG,
  YouTubeOAuthState,
} from '@kit/publishing/oauth/youtube';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { vendorUrl } from '@kit/shared/vendors';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * YouTube OAuth Callback Route
 * Handles the OAuth callback from Google, exchanges code for tokens,
 * and stores the connection (or redirects to channel picker if multiple channels)
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
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';

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
    .select('id, nonce, user_id, platform, metadata, expires_at, created_at')
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

  // Get global OAuth credentials (configured by super admin)
  const { getGlobalOAuthCredentials } = await import('@kit/publishing/server');
  const credentials = await getGlobalOAuthCredentials('youtube');

  if (!credentials) {
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
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
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

  // Get ALL channels (including brand channels) using googleapis
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: tokens.access_token });
  const youtube = youtubeApi({
    version: 'v3',
    auth: oauth2Client,
    rootUrl: vendorUrl('youtube-data'),
  });

  interface ChannelInfo {
    id: string;
    title: string;
    thumbnailUrl?: string;
    subscriberCount?: string;
  }

  let channels: ChannelInfo[] = [];

  try {
    // Fetch ALL channels (personal + brand) with mine=true
    // This returns all channels the authenticated user owns, including brand channels
    const channelResponse = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    channels = (channelResponse.data.items || []).map((ch) => ({
      id: ch.id!,
      title: ch.snippet?.title || 'Unknown Channel',
      thumbnailUrl: ch.snippet?.thumbnails?.default?.url || undefined,
      subscriberCount: ch.statistics?.subscriberCount || undefined,
    }));

    logger.info(
      {
        ...ctx,
        channelCount: channels.length,
        channelNames: channels.map((c) => c.title),
      },
      'Found YouTube channels',
    );

    if (channels.length === 0) {
      return NextResponse.redirect(
        `${appUrl}/settings/platforms?error=no_channel`,
      );
    }
  } catch (channelError) {
    logger.error({ ...ctx, error: channelError }, 'Failed to get channels');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=channel_fetch_failed`,
    );
  }

  // Get account slug for redirect
  const { data: accountData } = await client
    .from('accounts')
    .select('slug')
    .eq('id', state.accountId)
    .single();
  const accountSlug = accountData?.slug || 'unknown';

  // If multiple channels, store tokens in cookie and redirect to channel picker
  if (channels.length > 1) {
    const pendingConnection = {
      accountId: state.accountId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      channels,
      returnUrl: state.returnUrl,
      nonce: state.nonce,
    };

    // Store the pending connection data in an encrypted cookie
    const encryptedPending = await encrypt(JSON.stringify(pendingConnection));

    const response = NextResponse.redirect(
      `${appUrl}/home/${accountSlug}/settings/platforms/youtube/select-channel`,
    );

    response.cookies.set('youtube_pending_connection', encryptedPending, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
    });

    return response;
  }

  // Single channel - save directly (original behavior)
  const channel = channels[0]!;

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
        platform_account_name: channel.title,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString(),
        scopes: [...YOUTUBE_OAUTH_CONFIG.scopes],
        metadata: {
          thumbnail_url: channel.thumbnailUrl,
          // No subscriber_count. It was written here and read nowhere — a
          // level captured once, at a date nobody recorded, then left to
          // rot. FILM-1607 stores the dated series in ClickHouse instead.
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
    `${appUrl}/home/${accountSlug}/settings/platforms?success=youtube_connected&channel=${encodeURIComponent(channel.title)}`,
  );
}
