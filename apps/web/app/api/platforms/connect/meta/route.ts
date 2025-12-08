import { NextRequest, NextResponse } from 'next/server';

import { META_OAUTH_CONFIG, MetaOAuthState } from '@kit/publishing/oauth/meta';
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

  const accountId = request.nextUrl.searchParams.get('accountId');
  const returnUrl =
    request.nextUrl.searchParams.get('returnUrl') || '/settings/platforms';
  const platformsParam = request.nextUrl.searchParams.get('platforms');
  const platforms = (platformsParam?.split(',') || [
    'facebook',
    'instagram',
  ]) as ('facebook' | 'instagram')[];

  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
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

  const appId = process.env.FACEBOOK_APP_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appId || !appUrl) {
    logger.error(ctx, 'Missing FACEBOOK_APP_ID or NEXT_PUBLIC_APP_URL');
    return NextResponse.json(
      { error: 'Meta OAuth not configured' },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${appUrl}/api/platforms/callback/meta`,
    response_type: 'code',
    scope: META_OAUTH_CONFIG.scopes.join(','),
    state: encodedState,
  });

  return NextResponse.redirect(
    `${META_OAUTH_CONFIG.authUrl}?${params.toString()}`,
  );
}
