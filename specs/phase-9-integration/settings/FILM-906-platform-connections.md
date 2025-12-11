# FILM-906: Platform Connections

## Metadata
- **Phase:** 9 - Integration
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-705-707 (OAuth flows)
- **Blocks:** FILM-708 (Publish Hub)
- **Status:** ✅ COMPLETE
- **PR:** [#74](https://github.com/aroundAI/storybook/pull/74)
- **Commits:** `79201ef`, `d041997`

---

## Context

The Platform Connections page allows users to manage their connected social media accounts for publishing. Users can connect multiple accounts per platform, view connection status, refresh tokens, and disconnect accounts.

---

## Implementation Summary

### Files Created

| File | Lines | Description |
|------|-------|-------------|
| `apps/web/app/home/[account]/settings/platforms/page.tsx` | 47 | Server component with `withI18n`, `TeamAccountLayoutPageHeader`, `loadTeamWorkspace` |
| `packages/features/publishing/src/components/platform-connections.tsx` | 457 | Client component with React Query, TikTok SVG icon, loading skeletons, toast notifications |
| `packages/features/publishing/src/server/connection-actions.ts` | 175 | Server actions: `getConnectionsAction`, `disconnectPlatformAction`, `refreshConnectionAction` |
| `packages/features/publishing/src/types.ts` | 43 | TypeScript interfaces: `PlatformType`, `ConnectionStatus`, `PlatformConnection`, `PlatformConfig` |
| `apps/web/public/locales/en/platforms.json` | 19 | i18n translations for all UI strings |

### Files Modified

| File | Change |
|------|--------|
| `packages/features/publishing/package.json` | Added exports for `components/platform-connections`, `server/connection-actions`, `types`; Added dependencies `@tanstack/react-query`, `date-fns` |
| `apps/web/config/paths.config.ts` | Added `accountPlatforms` path |
| `apps/web/config/team-account-navigation.config.tsx` | Added "Platforms" nav item with `Share2` icon |
| `apps/web/lib/i18n/i18n.settings.ts` | Added `'platforms'` to `defaultI18nNamespaces` |
| `apps/web/public/locales/en/common.json` | Added `platforms` route label |

### Implementation Differences from Spec

| Spec | Implementation | Reason |
|------|----------------|--------|
| `withI18n` from `@kit/i18n/server` | `withI18n` from `~/lib/i18n/with-i18n` | Local path matches existing codebase patterns |
| Static metadata export | `generateMetadata` with i18n | Dynamic i18n-aware title generation |
| Direct page layout | `TeamAccountLayoutPageHeader` + `PageBody` | Matches existing settings page patterns (FILM-904, FILM-905) |
| `getConnectionsAction` uses `user.accountId` | Accepts `accountId` as parameter | Component passes accountId explicitly for proper cache key |
| `disconnectPlatformAction({ connectionId })` | `disconnectPlatformAction({ connectionId, platform })` | Routes to platform-specific disconnect handlers (YouTube, TikTok, Meta) |
| Basic status badges | Dark mode support with explicit dark: classes | Better accessibility in both themes |
| No loading state | `Skeleton` loading cards during data fetch | Better UX during initial load |
| No error handling on mutations | `toast.success/error` notifications | User feedback on success/failure |
| No URL encoding | `encodeURIComponent(accountSlug)` | URL safety for OAuth redirects |
| lucide-react TikTok icon | Custom `TikTokIcon` SVG component | lucide-react doesn't include TikTok icon |

### Component Architecture

```
PlatformConnections (main component)
├── useQuery: ['platform-connections', accountId]
├── PLATFORMS config array (YouTube, TikTok, Instagram, Facebook)
└── PlatformCard (per platform)
    ├── Platform icon + metadata
    ├── Connect button → initiateOAuth()
    ├── Empty state when no connections
    └── ConnectionRow (per connection)
        ├── Avatar with profile image
        ├── ConnectionStatusBadge (active/expired/error)
        ├── formatDistanceToNow for "Connected X ago"
        ├── Refresh button (active only) → refreshMutation
        ├── Reconnect button (expired only) → initiateOAuth()
        ├── Disconnect button → AlertDialog → disconnectMutation
        └── Error alert (when status === 'error')
```

### Server Action Flow

```
getConnectionsAction
├── Input: { accountId: string }
├── Query: platform_connections WHERE account_id = accountId
├── Transform: DB rows → PlatformConnection interface
└── Output: PlatformConnection[]

disconnectPlatformAction
├── Input: { connectionId, platform }
├── Switch on platform:
│   ├── youtube → disconnectYouTubeAction (revokes at Google)
│   ├── tiktok → disconnectTikTokAction (revokes at TikTok)
│   ├── instagram/facebook → disconnectMetaAction (revokes at Meta)
│   └── twitter/linkedin → deleteConnection (DB delete only)
└── Output: { success: true }

refreshConnectionAction
├── Input: { connectionId }
├── Call: ensureValidToken(connectionId)
│   └── Uses platform-specific refresh logic from token-refresh.ts
└── Output: { success: true } or throws on failure
```

---

## Specification

### Requirements

1. **Multi-Account Support**: Connect multiple YouTube channels, TikTok accounts, etc.
2. **Connection Status**: Show active/expired/error states
3. **Token Management**: Automatic refresh, manual re-authorization
4. **Account Details**: Show platform username, profile picture, permissions
5. **Disconnect Flow**: Clean removal with confirmation
6. **Error Recovery**: Clear guidance when connections fail

### Platform Connections Page

```typescript
// apps/web/app/home/[account]/settings/platforms/page.tsx

import { Metadata } from 'next';
import { withI18n } from '@kit/i18n/server';
import { PlatformConnections } from '@kit/publishing/components/platform-connections';

export const metadata: Metadata = {
  title: 'Platform Connections | Settings',
  description: 'Manage your connected publishing platforms',
};

async function PlatformConnectionsPage({ params }: { params: { account: string } }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Connections</h1>
        <p className="text-muted-foreground">
          Connect your social media accounts to publish content directly.
        </p>
      </div>

      <PlatformConnections accountSlug={params.account} />
    </div>
  );
}

export default withI18n(PlatformConnectionsPage);
```

### Platform Connections Component

```typescript
// packages/features/publishing/src/components/platform-connections.tsx

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@kit/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Alert, AlertDescription } from '@kit/ui/alert';
import {
  Youtube,
  Instagram,
  Facebook,
  Plus,
  RefreshCw,
  Trash2,
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  getConnectionsAction,
  disconnectPlatformAction,
  refreshConnectionAction,
} from '../server/connection-actions';

interface PlatformConfig {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  description: string;
  scopes: string[];
  multiAccount: boolean;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    icon: Youtube,
    color: 'text-red-500',
    description: 'Publish to YouTube channels',
    scopes: ['Upload videos', 'Manage playlists', 'View analytics'],
    multiAccount: true,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
      </svg>
    ),
    color: 'text-black dark:text-white',
    description: 'Publish to TikTok',
    scopes: ['Post videos', 'View insights'],
    multiAccount: false,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: Instagram,
    color: 'text-pink-500',
    description: 'Publish Reels to Instagram Business',
    scopes: ['Post Reels', 'View insights'],
    multiAccount: true,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: Facebook,
    color: 'text-blue-600',
    description: 'Publish to Facebook Pages',
    scopes: ['Post videos', 'Manage pages', 'View insights'],
    multiAccount: true,
  },
];

interface PlatformConnectionsProps {
  accountSlug: string;
}

export function PlatformConnections({ accountSlug }: PlatformConnectionsProps) {
  const { data: connections, isLoading } = useQuery({
    queryKey: ['platform-connections'],
    queryFn: getConnectionsAction,
  });

  return (
    <div className="space-y-6">
      {PLATFORMS.map((platform) => {
        const platformConnections = connections?.filter(
          (c) => c.platform === platform.id
        ) || [];

        return (
          <PlatformCard
            key={platform.id}
            platform={platform}
            connections={platformConnections}
            accountSlug={accountSlug}
          />
        );
      })}
    </div>
  );
}

interface PlatformCardProps {
  platform: PlatformConfig;
  connections: PlatformConnection[];
  accountSlug: string;
}

function PlatformCard({ platform, connections, accountSlug }: PlatformCardProps) {
  const Icon = platform.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className={`h-6 w-6 ${platform.color}`} />
            <div>
              <CardTitle className="text-lg">{platform.name}</CardTitle>
              <CardDescription>{platform.description}</CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => initiateOAuth(platform.id, accountSlug)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Connect {platform.multiAccount && connections.length > 0 ? 'Another' : ''}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p>No {platform.name} accounts connected</p>
            <p className="text-sm mt-1">
              Connect an account to start publishing
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                platform={platform}
              />
            ))}
          </div>
        )}

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            <strong>Permissions requested:</strong>{' '}
            {platform.scopes.join(', ')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface ConnectionRowProps {
  connection: PlatformConnection;
  platform: PlatformConfig;
}

function ConnectionRow({ connection, platform }: ConnectionRowProps) {
  const [showDisconnect, setShowDisconnect] = useState(false);
  const queryClient = useQueryClient();

  const refreshMutation = useMutation({
    mutationFn: () => refreshConnectionAction({ connectionId: connection.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-connections'] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectPlatformAction({ connectionId: connection.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-connections'] });
      setShowDisconnect(false);
    },
  });

  return (
    <>
      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={connection.profileImageUrl} />
            <AvatarFallback>
              {connection.accountName?.[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{connection.accountName}</span>
              <ConnectionStatus status={connection.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              Connected {formatDistanceToNow(new Date(connection.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {connection.status === 'expired' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => initiateOAuth(platform.id, connection.accountSlug)}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Reconnect
            </Button>
          )}

          {connection.status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDisconnect(true)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {connection.status === 'error' && connection.errorMessage && (
        <Alert variant="destructive" className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{connection.errorMessage}</AlertDescription>
        </Alert>
      )}

      <AlertDialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {platform.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove access to {connection.accountName}. You won't be able to
              publish to this account until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectionStatus({ status }: { status: PlatformConnection['status'] }) {
  const variants = {
    active: {
      icon: CheckCircle,
      label: 'Connected',
      className: 'bg-green-100 text-green-700',
    },
    expired: {
      icon: Clock,
      label: 'Expired',
      className: 'bg-amber-100 text-amber-700',
    },
    error: {
      icon: AlertCircle,
      label: 'Error',
      className: 'bg-red-100 text-red-700',
    },
  };

  const { icon: Icon, label, className } = variants[status];

  return (
    <Badge variant="outline" className={className}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

function initiateOAuth(platform: string, accountSlug: string) {
  // Redirect to OAuth flow
  window.location.href = `/api/platforms/connect/${platform}?account=${accountSlug}`;
}
```

### Types

```typescript
// packages/features/publishing/src/types.ts

export interface PlatformConnection {
  id: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  platformAccountId: string;
  accountName: string;
  profileImageUrl?: string;
  status: 'active' | 'expired' | 'error';
  errorMessage?: string;
  scopes: string[];
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  accountSlug: string;
}
```

### Server Actions

```typescript
// packages/features/publishing/src/server/connection-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';
import { ensureValidToken } from '../lib/token-refresh';

export const getConnectionsAction = enhanceAction(
  async (_, user) => {
    const client = getSupabaseServerClient();

    const { data: connections } = await client
      .from('platform_connections')
      .select('*')
      .eq('account_id', user.accountId)
      .order('created_at', { ascending: false });

    return connections?.map((conn) => ({
      id: conn.id,
      platform: conn.platform,
      platformAccountId: conn.platform_account_id,
      accountName: conn.platform_account_name,
      profileImageUrl: conn.metadata?.profile_image_url,
      status: determineStatus(conn),
      errorMessage: conn.metadata?.last_error,
      scopes: conn.scopes || [],
      tokenExpiresAt: conn.token_expires_at,
      createdAt: conn.created_at,
      updatedAt: conn.updated_at,
      accountSlug: user.accountSlug,
    })) || [];
  },
  { auth: true }
);

export const disconnectPlatformAction = enhanceAction(
  async ({ connectionId }, user) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('platform_connections')
      .delete()
      .eq('id', connectionId)
      .eq('account_id', user.accountId);

    if (error) throw error;

    return { success: true };
  },
  {
    schema: z.object({ connectionId: z.string().uuid() }),
    auth: true,
  }
);

export const refreshConnectionAction = enhanceAction(
  async ({ connectionId }, user) => {
    const result = await ensureValidToken(connectionId);

    if (!result.valid) {
      throw new Error(result.error || 'Failed to refresh token');
    }

    return { success: true };
  },
  {
    schema: z.object({ connectionId: z.string().uuid() }),
    auth: true,
  }
);

function determineStatus(connection: any): 'active' | 'expired' | 'error' {
  if (connection.metadata?.last_error) {
    return 'error';
  }

  if (connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at);
    if (expiresAt < new Date()) {
      return 'expired';
    }
  }

  if (!connection.is_active) {
    return 'expired';
  }

  return 'active';
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `apps/web/app/home/[account]/settings/platforms/page.tsx` |
| CREATE | `packages/features/publishing/src/components/platform-connections.tsx` |
| CREATE | `packages/features/publishing/src/server/connection-actions.ts` |
| CREATE | `packages/features/publishing/src/types.ts` |

---

## Acceptance Criteria

- [x] Lists all supported platforms (YouTube, TikTok, Instagram, Facebook)
- [x] Shows connected accounts per platform
- [x] Displays account name, profile picture, status
- [x] Connect button initiates OAuth flow
- [x] Refresh button updates token
- [x] Disconnect shows confirmation dialog
- [x] Status badges show active/expired/error
- [x] Error message displayed when relevant
- [x] Multiple accounts supported where applicable
- [x] Permissions shown per platform

---

## Test Plan

### Unit Tests
- [ ] Test status determination logic (`determineStatus` function)
- [ ] Test connection mapping (DB → PlatformConnection interface)
- [ ] Test schema validation for server actions

### Integration Tests
- [ ] Test OAuth initiation redirect (initiateOAuth function)
- [ ] Test disconnect flow (confirmation dialog → mutation → invalidate query)
- [ ] Test refresh token mutation (calls ensureValidToken)

### Manual Testing Checklist
- [x] Page loads at `/home/[account]/settings/platforms`
- [x] All 4 platforms displayed (YouTube, TikTok, Instagram, Facebook)
- [x] Connect button redirects to OAuth flow
- [x] Loading skeleton shown during data fetch
- [x] Connected accounts show name, avatar, status badge
- [x] Refresh button spins during mutation
- [x] Disconnect shows confirmation dialog
- [x] Toast notifications on success/error
- [x] Dark mode styling works correctly

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Token expired | "Expired" badge, "Reconnect" button |
| OAuth failed | Error alert with retry option |
| API error | Generic error message, try again |
| Network error | Toast notification, auto-retry |

---

## Security Considerations

- Tokens never exposed to client
- Disconnect removes all token data
- OAuth state validated on callback
- Rate limit OAuth initiations
