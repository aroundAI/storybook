import { NextRequest, NextResponse } from 'next/server';

import {
  LINKEDIN_OAUTH_CONFIG,
  LinkedInOAuthState,
} from '@kit/publishing/oauth/linkedin';
import { getOAuthAppCredentials } from '@kit/publishing/server/oauth-app-credentials';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  connectAccountError,
  resolveConnectAccount,
} from '~/lib/platforms/connect-landing';

/**
 * LinkedIn OAuth Connect Route
 * Initiates the OAuth flow by redirecting to LinkedIn's consent screen
 *
 * Query params:
 * - accountId: The account to connect the LinkedIn profile to
 * - returnUrl: Where to redirect after OAuth completes
 * - type: 'personal' (default) or 'company' for company page access
 */
export async function GET(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.linkedin.connect' };

  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  const returnUrl =
    request.nextUrl.searchParams.get('returnUrl') || '/settings/platforms';
  const isCompanyPage = request.nextUrl.searchParams.get('type') === 'company';

  const resolved = await resolveConnectAccount(request, client);

  if ('error' in resolved) {
    logger.error(
      { ...ctx, slug: resolved.slug, reason: resolved.error },
      'Failed to resolve the account to connect',
    );
    return connectAccountError(resolved.error);
  }

  const { accountId } = resolved;

  // Generate state with nonce for CSRF protection
  const nonce = crypto.randomUUID();
  const state: LinkedInOAuthState = {
    accountId,
    returnUrl,
    nonce,
    isCompanyPage,
  };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store nonce in session for verification
  const { error: insertError } = await client.from('oauth_states').insert({
    nonce,
    user_id: user.id,
    platform: 'linkedin',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    metadata: { isCompanyPage },
  });

  if (insertError) {
    logger.error({ ...ctx, error: insertError }, 'Failed to store OAuth state');
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 },
    );
  }

  const credentials = await getOAuthAppCredentials('linkedin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!credentials || !appUrl) {
    logger.error(
      ctx,
      'Missing LinkedIn app credentials or NEXT_PUBLIC_APP_URL',
    );
    return NextResponse.json(
      { error: 'LinkedIn OAuth not configured' },
      { status: 500 },
    );
  }

  // Select scopes based on connection type
  const scopes = isCompanyPage
    ? LINKEDIN_OAUTH_CONFIG.scopes.company
    : LINKEDIN_OAUTH_CONFIG.scopes.personal;

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: `${appUrl}/api/platforms/callback/linkedin`,
    response_type: 'code',
    scope: scopes.join(' '),
    state: encodedState,
  });

  return NextResponse.redirect(
    new URL(`${LINKEDIN_OAUTH_CONFIG.authUrl}?${params.toString()}`),
  );
}
