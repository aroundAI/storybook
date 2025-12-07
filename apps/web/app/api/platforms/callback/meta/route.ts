import { NextRequest, NextResponse } from 'next/server';

import { META_OAUTH_CONFIG, MetaOAuthState } from '@kit/publishing/oauth/meta';
import { encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

interface FacebookPageResponse {
  id: string;
  name: string;
  access_token: string;
  category: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string };
}

interface InstagramAccountResponse {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

/**
 * Meta OAuth Callback Route
 * Handles the OAuth callback from Facebook, exchanges code for tokens,
 * fetches Pages and Instagram accounts, and stores connections
 */
export async function GET(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'oauth.meta.callback' };

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
  let state: MetaOAuthState;
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
    .eq('platform', 'meta')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=state_expired`,
    );
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=meta_not_configured`,
    );
  }

  // Exchange code for short-lived token
  const tokenUrl = new URL(META_OAUTH_CONFIG.tokenUrl);
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set(
    'redirect_uri',
    `${appUrl}/api/platforms/callback/meta`,
  );
  tokenUrl.searchParams.set('code', code);

  const tokenResponse = await fetch(tokenUrl.toString());
  const shortLivedToken = await tokenResponse.json();

  if (shortLivedToken.error || !shortLivedToken.access_token) {
    logger.error(
      { ...ctx, error: shortLivedToken.error },
      'Token exchange failed',
    );
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=${encodeURIComponent(shortLivedToken.error?.message || 'token_exchange_failed')}`,
    );
  }

  // Exchange for long-lived token
  const longLivedUrl = new URL(
    `${META_OAUTH_CONFIG.graphUrl}/oauth/access_token`,
  );
  longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longLivedUrl.searchParams.set('client_id', appId);
  longLivedUrl.searchParams.set('client_secret', appSecret);
  longLivedUrl.searchParams.set(
    'fb_exchange_token',
    shortLivedToken.access_token,
  );

  const longLivedResponse = await fetch(longLivedUrl.toString());
  const longLivedToken = await longLivedResponse.json();

  if (longLivedToken.error || !longLivedToken.access_token) {
    logger.error(
      { ...ctx, error: longLivedToken.error },
      'Long-lived token exchange failed',
    );
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=token_exchange_failed`,
    );
  }

  const userAccessToken = longLivedToken.access_token;
  const expiresAt = new Date(
    Date.now() + (longLivedToken.expires_in || 5184000) * 1000,
  );

  // Get user's Pages with Instagram accounts
  const pagesUrl = new URL(`${META_OAUTH_CONFIG.graphUrl}/me/accounts`);
  pagesUrl.searchParams.set('access_token', userAccessToken);
  pagesUrl.searchParams.set(
    'fields',
    'id,name,access_token,category,picture,instagram_business_account',
  );

  const pagesResponse = await fetch(pagesUrl.toString());
  const pagesData = await pagesResponse.json();

  if (pagesData.error) {
    logger.error({ ...ctx, error: pagesData.error }, 'Failed to fetch Pages');
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=pages_fetch_failed`,
    );
  }

  const pages: FacebookPageResponse[] = pagesData.data || [];

  if (pages.length === 0) {
    return NextResponse.redirect(
      `${appUrl}/settings/platforms?error=no_pages_found`,
    );
  }

  // Store connections for each page and associated Instagram
  const connections: Array<{
    account_id: string;
    platform: string;
    platform_account_id: string;
    platform_account_name: string;
    access_token_encrypted: string;
    refresh_token_encrypted: string;
    token_expires_at: string;
    scopes: string[];
    is_active: boolean;
    metadata: Record<string, unknown>;
    updated_at: string;
  }> = [];

  const encryptedUserToken = await encrypt(userAccessToken);

  for (const page of pages) {
    // Store Facebook Page connection
    if (state.platforms.includes('facebook')) {
      const encryptedPageToken = await encrypt(page.access_token);
      connections.push({
        account_id: state.accountId,
        platform: 'facebook',
        platform_account_id: page.id,
        platform_account_name: page.name,
        access_token_encrypted: encryptedPageToken, // Page access token (never expires)
        refresh_token_encrypted: encryptedUserToken, // User token for refresh
        token_expires_at: expiresAt.toISOString(),
        scopes: [...META_OAUTH_CONFIG.scopes],
        is_active: true,
        metadata: {
          category: page.category,
          picture_url: page.picture?.data?.url,
          user_token_expires_at: expiresAt.toISOString(),
        },
        updated_at: new Date().toISOString(),
      });
    }

    // Store Instagram Business connection if linked
    if (
      state.platforms.includes('instagram') &&
      page.instagram_business_account
    ) {
      const igAccountId = page.instagram_business_account.id;

      // Get Instagram account details
      const igUrl = new URL(`${META_OAUTH_CONFIG.graphUrl}/${igAccountId}`);
      igUrl.searchParams.set('access_token', page.access_token);
      igUrl.searchParams.set(
        'fields',
        'username,name,profile_picture_url,followers_count',
      );

      const igResponse = await fetch(igUrl.toString());
      const igAccount: InstagramAccountResponse = await igResponse.json();

      if (!igAccount.id) {
        logger.warn(
          { ...ctx, pageId: page.id },
          'Failed to fetch Instagram account details',
        );
        continue;
      }

      const encryptedPageToken = await encrypt(page.access_token);
      connections.push({
        account_id: state.accountId,
        platform: 'instagram',
        platform_account_id: igAccountId,
        platform_account_name:
          igAccount.username || igAccount.name || igAccountId,
        access_token_encrypted: encryptedPageToken, // Use Page token for Instagram API
        refresh_token_encrypted: encryptedUserToken, // User token for refresh
        token_expires_at: expiresAt.toISOString(),
        scopes: ['instagram_basic', 'instagram_content_publish'],
        is_active: true,
        metadata: {
          linked_page_id: page.id,
          profile_picture_url: igAccount.profile_picture_url,
          followers_count: igAccount.followers_count,
          user_token_expires_at: expiresAt.toISOString(),
        },
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Upsert all connections
  if (connections.length > 0) {
    const { error: insertError } = await client
      .from('platform_connections')
      .upsert(connections, {
        onConflict: 'account_id,platform,platform_account_id',
      });

    if (insertError) {
      logger.error(
        { ...ctx, error: insertError },
        'Failed to store connections',
      );
      return NextResponse.redirect(
        `${appUrl}/settings/platforms?error=storage_failed`,
      );
    }
  }

  // Clean up used state after successful connection storage
  const { error: deleteError } = await client
    .from('oauth_states')
    .delete()
    .eq('nonce', state.nonce);

  if (deleteError) {
    logger.warn(
      { ...ctx, error: deleteError },
      'Failed to cleanup OAuth state',
    );
  }

  const connectedCount = connections.length;
  const platformNames = connections
    .map((c) => c.platform_account_name)
    .join(', ');

  return NextResponse.redirect(
    `${state.returnUrl}?success=meta_connected&count=${connectedCount}&accounts=${encodeURIComponent(platformNames)}`,
  );
}
