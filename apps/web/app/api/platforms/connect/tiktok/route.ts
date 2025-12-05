import { NextRequest, NextResponse } from 'next/server';

import {
  TIKTOK_OAUTH_CONFIG,
  TikTokOAuthState,
  generateCodeChallenge,
  generateCodeVerifier,
} from '@kit/publishing/oauth/tiktok';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * TikTok OAuth Connect Route
 * Initiates the OAuth flow with PKCE by redirecting to TikTok's authorization page
 *
 * Query params:
 * - accountId: The account to connect the TikTok account to
 * - returnUrl: Where to redirect after OAuth completes
 */
export async function GET(request: NextRequest) {
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

  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
  }

  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const nonce = crypto.randomUUID();

  // Store state with code verifier for token exchange
  const state: TikTokOAuthState = { accountId, returnUrl, nonce };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store state server-side (code verifier must not be in URL)
  // Note: Type assertion needed until database types are regenerated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (client as any)
    .from('oauth_states')
    .insert({
      nonce,
      user_id: user.id,
      platform: 'tiktok',
      metadata: { codeVerifier }, // Stored securely in database
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    });

  if (insertError) {
    console.error('[TikTok OAuth] Failed to store state:', insertError);
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 },
    );
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientKey || !appUrl) {
    console.error(
      '[TikTok OAuth] Missing TIKTOK_CLIENT_KEY or NEXT_PUBLIC_APP_URL',
    );
    return NextResponse.json(
      { error: 'TikTok OAuth not configured' },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: `${appUrl}/api/platforms/callback/tiktok`,
    response_type: 'code',
    scope: TIKTOK_OAUTH_CONFIG.scopes.join(','), // TikTok uses comma-separated
    state: encodedState,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(
    `${TIKTOK_OAUTH_CONFIG.authUrl}?${params.toString()}`,
  );
}
