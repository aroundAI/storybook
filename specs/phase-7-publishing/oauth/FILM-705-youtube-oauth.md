# FILM-705: YouTube OAuth

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-CC-03 (OAuth Token Refresh)
- **Blocks:** FILM-701 (YouTube Provider), FILM-708 (Publish Hub)

---

## Context

YouTube requires OAuth 2.0 for uploading videos on behalf of users. This spec covers the OAuth flow for connecting YouTube channels, including consent screen, token storage, and refresh handling.

---

## Specification

### Requirements

1. **OAuth Consent Flow**: Redirect to Google OAuth with correct scopes
2. **Token Exchange**: Exchange auth code for access/refresh tokens
3. **Token Storage**: Encrypt and store tokens securely
4. **Channel Selection**: Support users with multiple channels
5. **Scope Validation**: Ensure all required scopes are granted
6. **Disconnect Flow**: Revoke tokens and remove connection

### OAuth Configuration

```typescript
// packages/features/publishing/src/oauth/youtube/config.ts

export const YOUTUBE_OAUTH_CONFIG = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ],
  // Token expires in 1 hour, refresh 5 minutes before
  tokenRefreshBuffer: 5 * 60 * 1000,
};

export interface YouTubeOAuthState {
  accountId: string;
  returnUrl: string;
  nonce: string;
}
```

### Connect Route

```typescript
// apps/web/app/api/platforms/connect/youtube/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { YOUTUBE_OAUTH_CONFIG } from '@kit/publishing/oauth/youtube';
import { encrypt } from '@kit/shared/encryption';

export async function GET(request: NextRequest) {
  const client = getSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect('/auth/sign-in');
  }

  const accountId = request.nextUrl.searchParams.get('accountId');
  const returnUrl = request.nextUrl.searchParams.get('returnUrl') || '/settings/platforms';

  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
  }

  // Generate state with nonce for CSRF protection
  const nonce = crypto.randomUUID();
  const state: YouTubeOAuthState = { accountId, returnUrl, nonce };
  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64url');

  // Store nonce in session for verification
  await client
    .from('oauth_states')
    .insert({
      nonce,
      user_id: user.id,
      platform: 'youtube',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    });

  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/platforms/callback/youtube`,
    response_type: 'code',
    scope: YOUTUBE_OAUTH_CONFIG.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent', // Force consent to get refresh token
    state: encodedState,
  });

  return NextResponse.redirect(`${YOUTUBE_OAUTH_CONFIG.authUrl}?${params}`);
}
```

### Callback Route

```typescript
// apps/web/app/api/platforms/callback/youtube/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { YOUTUBE_OAUTH_CONFIG, YouTubeOAuthState } from '@kit/publishing/oauth/youtube';
import { encrypt } from '@kit/shared/encryption';
import { google } from 'googleapis';

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
  let state: YouTubeOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return NextResponse.redirect('/settings/platforms?error=invalid_state');
  }

  // Verify nonce
  const { data: storedState, error: stateError } = await client
    .from('oauth_states')
    .select('*')
    .eq('nonce', state.nonce)
    .eq('user_id', user.id)
    .eq('platform', 'youtube')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !storedState) {
    return NextResponse.redirect('/settings/platforms?error=state_expired');
  }

  // Clean up used state
  await client.from('oauth_states').delete().eq('nonce', state.nonce);

  // Exchange code for tokens
  const tokenResponse = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/platforms/callback/youtube`,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    return NextResponse.redirect(
      `/settings/platforms?error=${encodeURIComponent(tokens.error_description || tokens.error)}`
    );
  }

  // Get channel info
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokens.access_token });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const channelResponse = await youtube.channels.list({
    part: ['snippet', 'statistics'],
    mine: true,
  });

  const channel = channelResponse.data.items?.[0];
  if (!channel) {
    return NextResponse.redirect('/settings/platforms?error=no_channel');
  }

  // Store connection
  const { error: insertError } = await client
    .from('platform_connections')
    .upsert({
      account_id: state.accountId,
      platform: 'youtube',
      platform_account_id: channel.id,
      platform_account_name: channel.snippet?.title,
      access_token_encrypted: encrypt(tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : null,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: YOUTUBE_OAUTH_CONFIG.scopes,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'account_id,platform,platform_account_id',
    });

  if (insertError) {
    console.error('Failed to store YouTube connection:', insertError);
    return NextResponse.redirect('/settings/platforms?error=storage_failed');
  }

  return NextResponse.redirect(
    `${state.returnUrl}?success=youtube_connected&channel=${encodeURIComponent(channel.snippet?.title || '')}`
  );
}
```

### Disconnect Action

```typescript
// packages/features/publishing/src/oauth/youtube/disconnect.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { decrypt } from '@kit/shared/encryption';
import { YOUTUBE_OAUTH_CONFIG } from './config';
import { z } from 'zod';

export const disconnectYouTubeAction = enhanceAction(
  async ({ connectionId }) => {
    const client = getSupabaseServerClient();

    // Get connection
    const { data: connection } = await client
      .from('platform_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('platform', 'youtube')
      .single();

    if (!connection) {
      throw new Error('Connection not found');
    }

    // Revoke token at Google
    const accessToken = decrypt(connection.access_token_encrypted);
    await fetch(`${YOUTUBE_OAUTH_CONFIG.revokeUrl}?token=${accessToken}`, {
      method: 'POST',
    });

    // Delete connection
    await client
      .from('platform_connections')
      .delete()
      .eq('id', connectionId);

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
| CREATE | `packages/features/publishing/src/oauth/youtube/config.ts` |
| CREATE | `packages/features/publishing/src/oauth/youtube/disconnect.ts` |
| CREATE | `packages/features/publishing/src/oauth/youtube/index.ts` |
| CREATE | `apps/web/app/api/platforms/connect/youtube/route.ts` |
| CREATE | `apps/web/app/api/platforms/callback/youtube/route.ts` |
| CREATE | `apps/web/supabase/schemas/33-oauth-states.sql` |

---

## Acceptance Criteria

- [ ] Connect button redirects to Google consent screen
- [ ] Consent screen shows correct app name and scopes
- [ ] Callback exchanges code for tokens successfully
- [ ] Channel info is retrieved and stored
- [ ] Tokens are encrypted before storage
- [ ] Multiple channels per user are supported
- [ ] Disconnect revokes token at Google
- [ ] Disconnect removes connection from database
- [ ] State/nonce prevents CSRF attacks
- [ ] Expired states are rejected

---

## Test Plan

### Unit Tests
- [ ] Test state encoding/decoding
- [ ] Test nonce generation and validation

### Integration Tests
- [ ] Test OAuth flow with mocked Google endpoints
- [ ] Test token refresh flow
- [ ] Test disconnect flow

---

## Security Considerations

- Use HTTPS for all OAuth redirects
- State parameter prevents CSRF
- Nonce stored server-side prevents replay
- Tokens encrypted at rest
- Refresh tokens never exposed to client
- State expires after 10 minutes

---

## Error Handling

| Error | Handling |
|-------|----------|
| User denies consent | Redirect with `access_denied` error |
| Invalid state | Redirect with `invalid_state` error |
| Token exchange fails | Redirect with error description |
| No channel found | Redirect with `no_channel` error |
| Storage fails | Redirect with `storage_failed` error |

---

## Open Questions

- [ ] Should we support brand accounts? (post-MVP)
- [ ] Should we show quota remaining in UI? (future)
