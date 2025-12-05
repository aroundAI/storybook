# FILM-707: Meta OAuth (Instagram & Facebook)

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-CC-03 (OAuth Token Refresh)
- **Blocks:** FILM-703 (Instagram Provider), FILM-704 (Facebook Provider), FILM-708 (Publish Hub)

---

## Context

Meta uses a unified OAuth system for both Instagram and Facebook. This spec covers the Facebook Login flow that grants access to Instagram Professional accounts (Business or Creator) and Facebook Pages for video publishing.

---

## Specification

### Requirements

1. **Facebook Login**: Use Facebook Login to access both platforms
2. **Page Selection**: Let users select which Pages to connect
3. **Instagram Business**: Link Instagram Professional accounts via Page
4. **Long-Lived Tokens**: Exchange for 60-day tokens
5. **Page Access Tokens**: Store per-page tokens for publishing
6. **Reconnect Flow**: Handle expired tokens gracefully

### OAuth Configuration

```typescript
// packages/features/publishing/src/oauth/meta/config.ts

export const META_OAUTH_CONFIG = {
  authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
  tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
  graphUrl: 'https://graph.facebook.com/v18.0',
  scopes: [
    // Facebook Page publishing
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',

    // Video publishing
    'publish_video',

    // Instagram
    'instagram_basic',
    'instagram_content_publish',

    // Business features
    'business_management',
  ],
  // Short-lived token: ~1 hour
  // Long-lived token: ~60 days
  longLivedTokenExpiry: 60 * 24 * 60 * 60 * 1000,
};

export interface MetaOAuthState {
  accountId: string;
  returnUrl: string;
  nonce: string;
  platforms: ('facebook' | 'instagram')[];
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  category: string;
  pictureUrl?: string;
  instagramAccountId?: string;
}
```

### Connect Route

```typescript
// apps/web/app/api/platforms/connect/meta/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { META_OAUTH_CONFIG, MetaOAuthState } from '@kit/publishing/oauth/meta';

export async function GET(request: NextRequest) {
  const client = getSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect('/auth/sign-in');
  }

  const accountId = request.nextUrl.searchParams.get('accountId');
  const returnUrl = request.nextUrl.searchParams.get('returnUrl') || '/settings/platforms';
  const platforms = request.nextUrl.searchParams.get('platforms')?.split(',') || ['facebook', 'instagram'];

  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
  }

  const nonce = crypto.randomUUID();
  const state: MetaOAuthState = {
    accountId,
    returnUrl,
    nonce,
    platforms: platforms as ('facebook' | 'instagram')[],
  };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store nonce for verification
  await client
    .from('oauth_states')
    .insert({
      nonce,
      user_id: user.id,
      platform: 'meta',
      metadata: { platforms },
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/platforms/callback/meta`,
    response_type: 'code',
    scope: META_OAUTH_CONFIG.scopes.join(','),
    state: encodedState,
  });

  return NextResponse.redirect(`${META_OAUTH_CONFIG.authUrl}?${params}`);
}
```

### Callback Route

```typescript
// apps/web/app/api/platforms/callback/meta/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { META_OAUTH_CONFIG, MetaOAuthState, FacebookPage } from '@kit/publishing/oauth/meta';
import { encrypt } from '@kit/shared/encryption';

export async function GET(request: NextRequest) {
  const client = getSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect('/auth/sign-in');
  }

  const code = request.nextUrl.searchParams.get('code');
  const stateParam = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    const errorDesc = request.nextUrl.searchParams.get('error_description');
    return NextResponse.redirect(
      `/settings/platforms?error=${encodeURIComponent(errorDesc || error)}`
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect('/settings/platforms?error=missing_params');
  }

  // Decode and validate state
  let state: MetaOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return NextResponse.redirect('/settings/platforms?error=invalid_state');
  }

  // Verify nonce
  const { data: storedState } = await client
    .from('oauth_states')
    .select('*')
    .eq('nonce', state.nonce)
    .eq('user_id', user.id)
    .eq('platform', 'meta')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!storedState) {
    return NextResponse.redirect('/settings/platforms?error=state_expired');
  }

  await client.from('oauth_states').delete().eq('nonce', state.nonce);

  // Exchange code for short-lived token
  const tokenResponse = await fetch(
    `${META_OAUTH_CONFIG.tokenUrl}?` +
    new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/platforms/callback/meta`,
      code,
    })
  );

  const shortLivedToken = await tokenResponse.json();

  if (shortLivedToken.error) {
    return NextResponse.redirect(
      `/settings/platforms?error=${encodeURIComponent(shortLivedToken.error.message)}`
    );
  }

  // Exchange for long-lived token
  const longLivedResponse = await fetch(
    `${META_OAUTH_CONFIG.graphUrl}/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      fb_exchange_token: shortLivedToken.access_token,
    })
  );

  const longLivedToken = await longLivedResponse.json();
  const userAccessToken = longLivedToken.access_token;
  const expiresAt = new Date(Date.now() + (longLivedToken.expires_in || 5184000) * 1000);

  // Get user's Pages with Instagram accounts
  const pagesResponse = await fetch(
    `${META_OAUTH_CONFIG.graphUrl}/me/accounts?` +
    new URLSearchParams({
      access_token: userAccessToken,
      fields: 'id,name,access_token,category,picture,instagram_business_account',
    })
  );

  const pagesData = await pagesResponse.json();
  const pages: FacebookPage[] = pagesData.data || [];

  // Store connections for each page and associated Instagram
  const connections = [];

  for (const page of pages) {
    // Store Facebook Page connection
    if (state.platforms.includes('facebook')) {
      connections.push({
        account_id: state.accountId,
        platform: 'facebook',
        platform_account_id: page.id,
        platform_account_name: page.name,
        access_token_encrypted: encrypt(page.access_token), // Page access token (never expires)
        refresh_token_encrypted: encrypt(userAccessToken), // User token for refresh
        token_expires_at: expiresAt.toISOString(),
        scopes: META_OAUTH_CONFIG.scopes,
        is_active: true,
        metadata: {
          category: page.category,
          picture_url: page.picture?.data?.url,
          user_token_expires_at: expiresAt.toISOString(),
        },
      });
    }

    // Store Instagram Business connection if linked
    if (state.platforms.includes('instagram') && page.instagram_business_account) {
      const igAccountId = page.instagram_business_account.id;

      // Get Instagram account details
      const igResponse = await fetch(
        `${META_OAUTH_CONFIG.graphUrl}/${igAccountId}?` +
        new URLSearchParams({
          access_token: page.access_token,
          fields: 'username,name,profile_picture_url,followers_count',
        })
      );

      const igAccount = await igResponse.json();

      connections.push({
        account_id: state.accountId,
        platform: 'instagram',
        platform_account_id: igAccountId,
        platform_account_name: igAccount.username || igAccount.name,
        access_token_encrypted: encrypt(page.access_token), // Use Page token
        refresh_token_encrypted: encrypt(userAccessToken),
        token_expires_at: expiresAt.toISOString(),
        scopes: ['instagram_basic', 'instagram_content_publish'],
        is_active: true,
        metadata: {
          linked_page_id: page.id,
          profile_picture_url: igAccount.profile_picture_url,
          followers_count: igAccount.followers_count,
          user_token_expires_at: expiresAt.toISOString(),
        },
      });
    }
  }

  // Upsert all connections
  if (connections.length > 0) {
    const { error: insertError } = await client
      .from('platform_connections')
      .upsert(connections.map(c => ({
        ...c,
        updated_at: new Date().toISOString(),
      })), {
        onConflict: 'account_id,platform,platform_account_id',
      });

    if (insertError) {
      console.error('Failed to store Meta connections:', insertError);
      return NextResponse.redirect('/settings/platforms?error=storage_failed');
    }
  }

  const connectedCount = connections.length;
  return NextResponse.redirect(
    `${state.returnUrl}?success=meta_connected&count=${connectedCount}`
  );
}
```

### Token Refresh

```typescript
// packages/features/publishing/src/oauth/meta/refresh.ts

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { decrypt, encrypt } from '@kit/shared/encryption';
import { META_OAUTH_CONFIG } from './config';

export async function refreshMetaToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const client = getSupabaseServerClient();

  const { data: connection } = await client
    .from('platform_connections')
    .select('*')
    .eq('id', connectionId)
    .in('platform', ['facebook', 'instagram'])
    .single();

  if (!connection) {
    throw new Error('Connection not found');
  }

  // For Facebook/Instagram, we need to refresh the user token
  // Page tokens are long-lived and derived from user token
  const userToken = decrypt(connection.refresh_token_encrypted);

  // Exchange for new long-lived token
  const response = await fetch(
    `${META_OAUTH_CONFIG.graphUrl}/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      fb_exchange_token: userToken,
    })
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(`Meta refresh failed: ${data.error.message}`);
  }

  const newUserToken = data.access_token;
  const expiresAt = new Date(Date.now() + (data.expires_in || 5184000) * 1000);

  // Get fresh page token
  const pageId = connection.platform_account_id;
  const pagesResponse = await fetch(
    `${META_OAUTH_CONFIG.graphUrl}/${pageId}?` +
    new URLSearchParams({
      access_token: newUserToken,
      fields: 'access_token',
    })
  );

  const pageData = await pagesResponse.json();
  const newPageToken = pageData.access_token;

  // Update stored tokens
  await client
    .from('platform_connections')
    .update({
      access_token_encrypted: encrypt(newPageToken),
      refresh_token_encrypted: encrypt(newUserToken),
      token_expires_at: expiresAt.toISOString(),
      metadata: {
        ...connection.metadata,
        user_token_expires_at: expiresAt.toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  return {
    accessToken: newPageToken,
    expiresAt,
  };
}
```

### Disconnect Action

```typescript
// packages/features/publishing/src/oauth/meta/disconnect.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { decrypt } from '@kit/shared/encryption';
import { META_OAUTH_CONFIG } from './config';
import { z } from 'zod';

export const disconnectMetaAction = enhanceAction(
  async ({ connectionId }) => {
    const client = getSupabaseServerClient();

    const { data: connection } = await client
      .from('platform_connections')
      .select('*')
      .eq('id', connectionId)
      .in('platform', ['facebook', 'instagram'])
      .single();

    if (!connection) {
      throw new Error('Connection not found');
    }

    // Revoke permissions (optional - user can also manage in Facebook settings)
    const accessToken = decrypt(connection.access_token_encrypted);
    await fetch(
      `${META_OAUTH_CONFIG.graphUrl}/me/permissions?access_token=${accessToken}`,
      { method: 'DELETE' }
    );

    // Delete connection
    await client
      .from('platform_connections')
      .delete()
      .eq('id', connectionId);

    // If Instagram, also delete related Facebook connection if same page
    if (connection.platform === 'instagram' && connection.metadata?.linked_page_id) {
      await client
        .from('platform_connections')
        .delete()
        .eq('account_id', connection.account_id)
        .eq('platform', 'facebook')
        .eq('platform_account_id', connection.metadata.linked_page_id);
    }

    return { success: true };
  },
  {
    schema: z.object({ connectionId: z.string().uuid() }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/oauth/meta/config.ts` |
| CREATE | `packages/features/publishing/src/oauth/meta/refresh.ts` |
| CREATE | `packages/features/publishing/src/oauth/meta/disconnect.ts` |
| CREATE | `packages/features/publishing/src/oauth/meta/index.ts` |
| CREATE | `apps/web/app/api/platforms/connect/meta/route.ts` |
| CREATE | `apps/web/app/api/platforms/callback/meta/route.ts` |

---

## Acceptance Criteria

- [ ] Connect button redirects to Facebook Login
- [ ] Consent screen shows correct permissions
- [ ] User can select which Pages to connect
- [ ] Long-lived tokens are obtained (60-day)
- [ ] Page access tokens are stored per-page
- [ ] Instagram Business accounts are detected
- [ ] Instagram connections link to parent Page
- [ ] Token refresh works for both platforms
- [ ] Disconnect removes related connections
- [ ] Proper error messages for permission issues

---

## Test Plan

### Unit Tests
- [ ] Test state encoding/decoding
- [ ] Test page selection logic

### Integration Tests
- [ ] Test OAuth flow with mocked Meta endpoints
- [ ] Test token refresh
- [ ] Test Instagram-Page linking

---

## Security Considerations

- Long-lived tokens stored encrypted
- Page tokens never exposed to client
- State parameter prevents CSRF
- Revoke permissions on disconnect
- User token stored separately for refresh

---

## Meta Platform Specifics

1. **Token Types**:
   - Short-lived user token (~1 hour)
   - Long-lived user token (~60 days)
   - Page access token (never expires if user token valid)

2. **Instagram Requirements**:
   - Must be Instagram Professional (Business or Creator)
   - Must be linked to Facebook Page
   - Uses Page access token, not user token

3. **Permission Model**:
   - User grants permissions at Facebook Login
   - Permissions apply to all Pages user manages
   - Can be revoked per-app in Facebook settings

---

## Error Handling

| Error | Handling |
|-------|----------|
| `OAuthException` | Token expired or invalid |
| `GraphMethodException` | Permission denied |
| No Pages found | Show "Connect a Page first" message |
| No Instagram linked | Show "Link Instagram to Page" message |
| App not verified | Show "App under review" message |

---

## Open Questions

- [ ] Should we support multiple Pages per connection? (post-MVP)
- [ ] Should we store Page category for filtering? (future)
