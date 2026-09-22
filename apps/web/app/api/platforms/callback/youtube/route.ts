import { NextRequest, NextResponse } from 'next/server';

import { youtube as youtubeApi } from '@googleapis/youtube';
import { OAuth2Client } from 'google-auth-library';

import { parseGrantedScopes } from '@kit/publishing/oauth/analytics-scopes';
import {
  YOUTUBE_OAUTH_CONFIG,
  YouTubeOAuthState,
} from '@kit/publishing/oauth/youtube';
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

/**
 * YouTube OAuth Callback Route
 * Handles the OAuth callback from Google, exchanges code for tokens,
 * and stores the connection (or redirects to channel picker if multiple channels)
 */
async function handleCallback(request: NextRequest) {
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

  // Every way of giving up goes through here: one log line, one landing page.
  const fail = (failure: CallbackFailure) =>
    failConnect({
      request,
      platform: 'youtube',
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
  let state: YouTubeOAuthState;
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
    .eq('platform', 'youtube')
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
  const { getGlobalOAuthCredentials } = await import('@kit/publishing/server');
  const credentials = await getGlobalOAuthCredentials('youtube');

  if (!credentials) {
    return fail({ code: 'not_configured', branch: 'credentials_missing' });
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

  // Get ALL channels (including brand channels) using googleapis
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: tokens.access_token });
  const youtube = youtubeApi({ version: 'v3', auth: oauth2Client });

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
      return fail({ code: 'no_channel', branch: 'no_channel' });
    }
  } catch (channelError) {
    return fail({
      code: 'account_lookup_failed',
      branch: 'channel_fetch',
      cause: channelError,
    });
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
      grantedScopes: parseGrantedScopes(tokens.scope),
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
        // What Google granted, not what we asked for: a user can untick a
        // scope on the consent screen, and the token response says so.
        scopes: parseGrantedScopes(tokens.scope),
        metadata: {
          scopes_granted_at: new Date().toISOString(),
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
    `${appUrl}/home/${accountSlug}/settings/platforms?success=youtube_connected&channel=${encodeURIComponent(channel.title)}`,
  );
}

export const GET = catchConnectFailures('youtube', handleCallback);
