import { NextRequest, NextResponse } from 'next/server';

import {
  YOUTUBE_OAUTH_CONFIG,
  YouTubeOAuthState,
} from '@kit/publishing/oauth/youtube';
import { getAccountOAuthApp } from '@kit/publishing/server';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * YouTube OAuth Connect Route
 * Initiates the OAuth flow by redirecting to Google's consent screen
 *
 * Query params:
 * - accountId or account: The account to connect the YouTube channel to
 * - returnUrl: Where to redirect after OAuth completes
 */
export async function GET(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.youtube.connect' };

  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  // Support both accountId (UUID) and account (slug)
  let accountId = request.nextUrl.searchParams.get('accountId');
  const accountSlug = request.nextUrl.searchParams.get('account');
  const returnUrl =
    request.nextUrl.searchParams.get('returnUrl') || '/settings/platforms';

  // If we got a slug instead of UUID, resolve it
  if (!accountId && accountSlug) {
    const { data: account, error: accountError } = await client
      .from('accounts')
      .select('id')
      .eq('slug', accountSlug)
      .single();

    if (accountError || !account) {
      logger.error(
        { ...ctx, slug: accountSlug, error: accountError },
        'Failed to resolve account slug',
      );
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    accountId = account.id;
  }

  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
  }

  // Get OAuth credentials from database (account-scoped)
  const oauthApp = await getAccountOAuthApp(accountId, 'youtube');
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (!oauthApp) {
    logger.error(ctx, 'YouTube OAuth credentials not found for this account');
    return NextResponse.json(
      {
        error:
          'YouTube OAuth not configured. Please add your Google OAuth credentials in Platforms settings.',
      },
      { status: 400 },
    );
  }

  if (!appUrl) {
    logger.error(ctx, 'Missing NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_APP_URL');
    return NextResponse.json(
      { error: 'Application URL not configured' },
      { status: 500 },
    );
  }

  // Generate state with nonce for CSRF protection
  const nonce = crypto.randomUUID();
  const state: YouTubeOAuthState = { accountId, returnUrl, nonce };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store nonce in session for verification
  const { error: insertError } = await client.from('oauth_states').insert({
    nonce,
    user_id: user.id,
    platform: 'youtube',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
  });

  if (insertError) {
    logger.error({ ...ctx, error: insertError }, 'Failed to store OAuth state');
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_id: oauthApp.clientId,
    redirect_uri: `${appUrl}/api/platforms/callback/youtube`,
    response_type: 'code',
    scope: YOUTUBE_OAUTH_CONFIG.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent', // Force consent to get refresh token
    state: encodedState,
  });

  return NextResponse.redirect(
    `${YOUTUBE_OAUTH_CONFIG.authUrl}?${params.toString()}`,
  );
}
