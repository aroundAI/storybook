import { NextRequest, NextResponse } from 'next/server';

import { META_OAUTH_CONFIG, MetaOAuthState } from '@kit/publishing/oauth/meta';
import { getAccountOAuthApp } from '@kit/publishing/server';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Meta OAuth Connect Route
 * Initiates the OAuth flow by redirecting to Facebook's consent screen
 *
 * Query params:
 * - accountId: The account to connect the Meta platforms to
 * - returnUrl: Where to redirect after OAuth completes
 * - platforms: Comma-separated list of platforms to connect (facebook,instagram)
 */
export async function GET(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.meta.connect' };

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
  const platformsParam = request.nextUrl.searchParams.get('platforms');
  const platforms = (platformsParam?.split(',') || [
    'facebook',
    'instagram',
  ]) as ('facebook' | 'instagram')[];

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
  const oauthApp = await getAccountOAuthApp(accountId, 'meta');
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (!oauthApp) {
    logger.error(ctx, 'Meta OAuth credentials not found for this account');
    return NextResponse.json(
      {
        error:
          'Meta OAuth not configured. Please add your Meta App credentials in Platforms settings.',
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
  const state: MetaOAuthState = { accountId, returnUrl, nonce, platforms };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store nonce in session for verification
  const { error: insertError } = await client.from('oauth_states').insert({
    nonce,
    user_id: user.id,
    platform: 'meta',
    metadata: { platforms },
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
    redirect_uri: `${appUrl}/api/platforms/callback/meta`,
    response_type: 'code',
    scope: META_OAUTH_CONFIG.scopes.join(','),
    state: encodedState,
  });

  return NextResponse.redirect(
    `${META_OAUTH_CONFIG.authUrl}?${params.toString()}`,
  );
}
