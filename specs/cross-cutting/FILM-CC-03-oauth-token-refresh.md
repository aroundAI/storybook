# FILM-CC-03: OAuth Token Refresh

## Metadata
- **Phase:** Cross-Cutting Concern
- **Priority:** P1 (High)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-101j (Platform Connections Table)
- **Blocks:** FILM-705, FILM-706, FILM-707 (OAuth flows), FILM-701-704 (Publishing providers)
- **Status:** ✅ Complete
- **Implemented:** 2025-12-05
- **PR:** [#6](https://github.com/aroundAI/storybook/pull/6)

---

## Context

Platform connections (YouTube, TikTok, Instagram) use OAuth tokens that expire. Without proactive refresh:
- Publishing fails mid-upload
- Users must manually reconnect frequently
- Scheduled posts fail silently

This spec defines a robust token refresh strategy with graceful degradation.

---

## Specification

### Requirements

1. **Proactive Refresh**: Refresh tokens before they expire
2. **Just-in-Time Refresh**: Refresh on demand if proactive refresh missed
3. **Failure Handling**: Mark connections as needing re-auth on refresh failure
4. **User Notification**: Alert users when re-authentication is required
5. **Background Job**: Cron job to refresh tokens expiring soon

### Token Refresh Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Token Refresh Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. API Call Requested                                          │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │ Check Token     │                                           │
│  │ Expiry          │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│     ┌─────┴─────┐                                              │
│     │           │                                               │
│  Valid      Expiring/Expired                                    │
│     │           │                                               │
│     │     ┌─────┴─────────┐                                    │
│     │     │ Refresh Token │                                    │
│     │     └─────┬─────────┘                                    │
│     │           │                                               │
│     │     ┌─────┴─────┐                                        │
│     │  Success     Failed                                       │
│     │     │           │                                         │
│     │     │     ┌─────┴───────────┐                            │
│     │     │     │ Mark Inactive   │                            │
│     │     │     │ Notify User     │                            │
│     │     │     └─────────────────┘                            │
│     │     │                                                     │
│     ▼     ▼                                                     │
│  ┌─────────────────┐                                           │
│  │ Make API Call   │                                           │
│  └─────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Token Refresh Service

```typescript
// packages/features/publishing/src/lib/token-refresh.ts

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { encrypt, decrypt } from '@kit/shared/crypto';
import { sendNotification } from '@kit/notifications';

interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

interface TokenValidationResult {
  valid: boolean;
  accessToken?: string;
  error?: 'EXPIRED' | 'REFRESH_FAILED' | 'CONNECTION_INACTIVE' | 'NOT_FOUND';
  requiresReauth?: boolean;
}

/**
 * Buffer time before expiry to trigger refresh (5 minutes)
 */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Ensures a valid access token is available for the connection.
 * Refreshes if needed, marks inactive if refresh fails.
 */
export async function ensureValidToken(
  connectionId: string
): Promise<TokenValidationResult> {
  const client = getSupabaseServerClient();

  // 1. Fetch connection
  const { data: connection, error } = await client
    .from('platform_connections')
    .select('*')
    .eq('id', connectionId)
    .single();

  if (error || !connection) {
    return { valid: false, error: 'NOT_FOUND' };
  }

  if (!connection.is_active) {
    return { valid: false, error: 'CONNECTION_INACTIVE', requiresReauth: true };
  }

  // 2. Check if token is still valid with buffer
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const needsRefresh = expiresAt.getTime() - now.getTime() < EXPIRY_BUFFER_MS;

  if (!needsRefresh) {
    // Token still valid
    const accessToken = await decrypt(connection.access_token_encrypted);
    return { valid: true, accessToken };
  }

  // 3. Attempt refresh
  try {
    const refreshToken = await decrypt(connection.refresh_token_encrypted);
    const refreshed = await refreshTokenForPlatform(
      connection.platform,
      refreshToken
    );

    // 4. Update stored tokens
    await client
      .from('platform_connections')
      .update({
        access_token_encrypted: await encrypt(refreshed.accessToken),
        refresh_token_encrypted: refreshed.refreshToken
          ? await encrypt(refreshed.refreshToken)
          : connection.refresh_token_encrypted,
        token_expires_at: refreshed.expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);

    return { valid: true, accessToken: refreshed.accessToken };
  } catch (refreshError) {
    // 5. Mark connection as inactive and notify user
    await client
      .from('platform_connections')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);

    await sendNotification(connection.account_id, {
      type: 'platform_reauth_required',
      title: `${formatPlatformName(connection.platform)} connection expired`,
      body: 'Please reconnect your account to continue publishing.',
      action: {
        label: 'Reconnect',
        url: `/settings/platforms?reconnect=${connection.platform}`,
      },
    });

    return {
      valid: false,
      error: 'REFRESH_FAILED',
      requiresReauth: true,
    };
  }
}

/**
 * Platform-specific token refresh implementations
 */
async function refreshTokenForPlatform(
  platform: string,
  refreshToken: string
): Promise<TokenRefreshResult> {
  switch (platform) {
    case 'youtube':
      return refreshYouTubeToken(refreshToken);
    case 'tiktok':
      return refreshTikTokToken(refreshToken);
    case 'instagram':
    case 'facebook':
      return refreshMetaToken(refreshToken, platform);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

async function refreshYouTubeToken(refreshToken: string): Promise<TokenRefreshResult> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`YouTube refresh failed: ${error.error_description || error.error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // YouTube may return new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

async function refreshTikTokToken(refreshToken: string): Promise<TokenRefreshResult> {
  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('TikTok refresh failed');
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // TikTok always returns new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

async function refreshMetaToken(
  refreshToken: string,
  platform: 'instagram' | 'facebook'
): Promise<TokenRefreshResult> {
  // Meta uses long-lived tokens that need to be exchanged before expiry
  const response = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      fb_exchange_token: refreshToken,
    })
  );

  if (!response.ok) {
    throw new Error('Meta refresh failed');
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    // Meta tokens are long-lived, expires_in is in seconds
    expiresAt: new Date(Date.now() + (data.expires_in || 5184000) * 1000), // Default 60 days
  };
}

function formatPlatformName(platform: string): string {
  const names: Record<string, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
  };
  return names[platform] || platform;
}
```

### Background Refresh Job

```typescript
// packages/features/publishing/src/jobs/refresh-expiring-tokens.ts

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { ensureValidToken } from '../lib/token-refresh';

/**
 * Cron job to proactively refresh tokens expiring within 1 hour.
 * Should run every 30 minutes.
 */
export async function refreshExpiringTokens(): Promise<{
  checked: number;
  refreshed: number;
  failed: number;
}> {
  const client = getSupabaseServerClient();
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

  // Find active connections expiring soon
  const { data: expiringConnections, error } = await client
    .from('platform_connections')
    .select('id, platform, account_id')
    .eq('is_active', true)
    .lt('token_expires_at', oneHourFromNow.toISOString())
    .order('token_expires_at', { ascending: true });

  if (error) {
    console.error('[TokenRefresh] Failed to query expiring connections:', error);
    return { checked: 0, refreshed: 0, failed: 0 };
  }

  const results = { checked: expiringConnections.length, refreshed: 0, failed: 0 };

  for (const conn of expiringConnections) {
    const result = await ensureValidToken(conn.id);
    if (result.valid) {
      results.refreshed++;
      console.log(`[TokenRefresh] Refreshed ${conn.platform} for account ${conn.account_id}`);
    } else {
      results.failed++;
      console.error(`[TokenRefresh] Failed ${conn.platform} for account ${conn.account_id}:`, result.error);
    }
  }

  console.log(`[TokenRefresh] Complete: ${results.refreshed}/${results.checked} refreshed, ${results.failed} failed`);
  return results;
}
```

### Cron API Route

```typescript
// apps/web/app/api/cron/refresh-tokens/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { refreshExpiringTokens } from '@kit/publishing/jobs';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await refreshExpiringTokens();
  return NextResponse.json(results);
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/lib/token-refresh.ts` |
| CREATE | `packages/features/publishing/src/jobs/refresh-expiring-tokens.ts` |
| CREATE | `apps/web/app/api/cron/refresh-tokens/route.ts` |

---

## Acceptance Criteria

- [x] Valid tokens are returned without refresh
- [x] Tokens expiring within 5 minutes are proactively refreshed
- [x] Expired tokens trigger refresh before API call
- [x] Failed refresh marks connection as inactive
- [x] Failed refresh sends user notification
- [x] Notification includes reconnect link
- [x] Background job refreshes tokens expiring within 1 hour
- [x] Cron endpoint is protected by secret
- [x] All refresh attempts are logged

---

## Test Plan

### Unit Tests
- [x] Test valid token returns immediately
- [x] Test near-expiry token triggers refresh
- [x] Test expired token triggers refresh
- [x] Test successful refresh updates database
- [x] Test failed refresh marks connection inactive
- [x] Test notification sent on failure

### Integration Tests
- [ ] Test full refresh flow with mocked OAuth endpoints
- [ ] Test cron job processes multiple connections
- [ ] Test concurrent refresh requests (no race conditions)

---

## Security Considerations

- **Token Storage**: All tokens encrypted at rest using `@kit/shared/crypto`
- **Secret Rotation**: Support for rotating CRON_SECRET
- **Logging**: Never log actual token values, only connection IDs
- **Rate Limiting**: OAuth endpoints may rate limit; handle 429 responses

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Network error during refresh | Retry once, then mark failed |
| Invalid refresh token | Mark connection inactive, notify user |
| Rate limited by OAuth provider | Back off and retry in background job |
| Connection not found | Return NOT_FOUND error |
| Connection already inactive | Return CONNECTION_INACTIVE error |

---

## Platform-Specific Notes

### YouTube
- Refresh tokens don't expire unless revoked
- May return new refresh token; always store if provided
- Supports offline access for background refresh

### TikTok
- Refresh tokens expire in 365 days
- Always returns new refresh token on refresh
- Requires `refresh_token` scope

### Instagram/Facebook (Meta)
- Uses long-lived tokens (60 days)
- Exchange token before expiry for new long-lived token
- No refresh token; exchange current access token

---

## Open Questions

- [ ] Should we implement retry with exponential backoff for refresh failures? (non-blocking)
- [ ] Should we support per-connection refresh token rotation? (non-blocking)
