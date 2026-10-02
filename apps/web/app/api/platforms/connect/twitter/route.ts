import { NextRequest, NextResponse } from 'next/server';

import { isOfferedPlatform } from '@kit/publishing/lib/platforms';
import {
  TWITTER_OAUTH_CONFIG,
  TwitterOAuthState,
  generateCodeChallenge,
  generateCodeVerifier,
} from '@kit/publishing/oauth/twitter';
import { getOAuthAppCredentials } from '@kit/publishing/server/oauth-app-credentials';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  connectAccountError,
  resolveConnectAccount,
} from '~/lib/platforms/connect-landing';

/**
 * Twitter/X OAuth Connect Route
 * Initiates the OAuth 2.0 flow with PKCE by redirecting to Twitter's authorization page
 *
 * Query params:
 * - accountId: The account to connect the Twitter account to
 * - returnUrl: Where to redirect after OAuth completes
 */
export async function GET(request: NextRequest) {
  // X is hidden while `X_ENABLED` is off: there is nothing to connect.
  if (!isOfferedPlatform('twitter')) {
    return new NextResponse(null, { status: 404 });
  }

  const logger = await getLogger();
  const ctx = { name: 'oauth.twitter.connect' };

  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  const returnUrl =
    request.nextUrl.searchParams.get('returnUrl') || '/settings/platforms';

  const resolved = await resolveConnectAccount(request, client);

  if ('error' in resolved) {
    logger.error(
      { ...ctx, slug: resolved.slug, reason: resolved.error },
      'Failed to resolve the account to connect',
    );
    return connectAccountError(resolved.error);
  }

  const { accountId } = resolved;

  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const nonce = crypto.randomUUID();

  // Store state with code verifier for token exchange
  const state: TwitterOAuthState = { accountId, returnUrl, nonce };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store state server-side (code verifier must not be in URL)
  const { error: insertError } = await client.from('oauth_states').insert({
    nonce,
    user_id: user.id,
    platform: 'twitter',
    metadata: { codeVerifier }, // Stored securely in database
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
  });

  if (insertError) {
    logger.error({ ...ctx, error: insertError }, 'Failed to store OAuth state');
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 },
    );
  }

  const credentials = await getOAuthAppCredentials('twitter');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!credentials || !appUrl) {
    logger.error(ctx, 'Missing X app credentials or NEXT_PUBLIC_APP_URL');
    return NextResponse.json(
      { error: 'Twitter OAuth not configured' },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: `${appUrl}/api/platforms/callback/twitter`,
    response_type: 'code',
    scope: TWITTER_OAUTH_CONFIG.scopes.join(' '), // Twitter uses space-separated scopes
    state: encodedState,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(
    new URL(`${TWITTER_OAUTH_CONFIG.authUrl}?${params.toString()}`),
  );
}
