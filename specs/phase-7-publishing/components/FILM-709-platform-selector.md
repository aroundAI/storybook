# FILM-709: Platform Selector

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** S (2-4 hours)
- **Dependencies:** FILM-705-707 (OAuth)
- **Blocks:** FILM-708 (Publish Hub)

---

## Context

The Platform Selector allows users to choose which connected platforms to publish to. It displays connection status, account info, and quick actions for managing connections.

---

## Specification

### Requirements

1. **Show Connected Platforms**: Display all platforms with connection status
2. **Toggle Selection**: Enable/disable platforms for publishing
3. **Account Preview**: Show connected account name/avatar
4. **Quick Connect**: Allow connecting new platforms inline
5. **Connection Health**: Show if tokens are valid/expired
6. **Multi-Account**: Support multiple accounts per platform

### Component Interface

```typescript
// packages/features/publishing/src/components/platform-selector.tsx

interface PlatformSelectorProps {
  platforms: PlatformPublishConfig[];
  onToggle: (platform: string, enabled: boolean) => void;
  onConnect?: (platform: string) => void;
}

interface PlatformConnection {
  id: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  platformAccountId: string;
  platformAccountName: string;
  avatarUrl?: string;
  isActive: boolean;
  tokenValid: boolean;
  followerCount?: number;
}
```

### Component Implementation

```tsx
// packages/features/publishing/src/components/platform-selector.tsx

'use client';

import { useState } from 'react';
import { Card, CardContent } from '@kit/ui/card';
import { Switch } from '@kit/ui/switch';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@kit/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@kit/ui/tooltip';
import {
  Youtube,
  Instagram,
  Facebook,
  AlertCircle,
  Plus,
  ChevronDown,
  Check,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

// TikTok icon (custom)
const TikTokIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const PLATFORM_CONFIG = {
  youtube: {
    name: 'YouTube',
    icon: Youtube,
    color: 'text-red-500',
    bgColor: 'bg-red-100',
    description: 'Videos, Shorts, Live',
  },
  tiktok: {
    name: 'TikTok',
    icon: TikTokIcon,
    color: 'text-black',
    bgColor: 'bg-gray-100',
    description: 'Videos up to 10 min',
  },
  instagram: {
    name: 'Instagram',
    icon: Instagram,
    color: 'text-pink-500',
    bgColor: 'bg-pink-100',
    description: 'Reels, Stories',
  },
  facebook: {
    name: 'Facebook',
    icon: Facebook,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    description: 'Videos, Reels',
  },
};

export function PlatformSelector({
  platforms,
  onToggle,
  onConnect,
}: PlatformSelectorProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid gap-3">
          {Object.entries(PLATFORM_CONFIG).map(([key, config]) => {
            const platform = platforms.find(p => p.platform === key);
            const isConnected = !!platform;
            const isEnabled = platform?.enabled ?? false;

            return (
              <PlatformRow
                key={key}
                platformKey={key as keyof typeof PLATFORM_CONFIG}
                config={config}
                connection={platform}
                isConnected={isConnected}
                isEnabled={isEnabled}
                onToggle={(enabled) => onToggle(key, enabled)}
                onConnect={() => onConnect?.(key)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface PlatformRowProps {
  platformKey: keyof typeof PLATFORM_CONFIG;
  config: typeof PLATFORM_CONFIG[keyof typeof PLATFORM_CONFIG];
  connection?: PlatformPublishConfig;
  isConnected: boolean;
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  onConnect: () => void;
}

function PlatformRow({
  platformKey,
  config,
  connection,
  isConnected,
  isEnabled,
  onToggle,
  onConnect,
}: PlatformRowProps) {
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
        isEnabled ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Platform Icon */}
        <div className={`p-2 rounded-lg ${config.bgColor}`}>
          <Icon className={`h-5 w-5 ${config.color}`} />
        </div>

        {/* Platform Info */}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{config.name}</span>
            {isConnected && connection?.tokenValid === false && (
              <Tooltip>
                <TooltipTrigger>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent>
                  Connection expired. Please reconnect.
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {isConnected ? (
            <AccountInfo connection={connection!} />
          ) : (
            <span className="text-sm text-muted-foreground">
              {config.description}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isConnected ? (
          <>
            {/* Account Selector for multiple accounts */}
            {connection?.accounts && connection.accounts.length > 1 && (
              <AccountSelector
                accounts={connection.accounts}
                selectedId={connection.connectionId}
                onChange={(id) => {
                  // Handle account switch
                }}
              />
            )}

            <Switch
              checked={isEnabled}
              onCheckedChange={onToggle}
              disabled={connection?.tokenValid === false}
            />
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onConnect}>
            <Plus className="mr-1 h-4 w-4" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function AccountInfo({ connection }: { connection: PlatformPublishConfig }) {
  return (
    <div className="flex items-center gap-2">
      {connection.avatarUrl && (
        <Avatar className="h-5 w-5">
          <AvatarImage src={connection.avatarUrl} />
          <AvatarFallback>{connection.platformAccountName?.[0]}</AvatarFallback>
        </Avatar>
      )}
      <span className="text-sm text-muted-foreground">
        {connection.platformAccountName}
      </span>
      {connection.followerCount && (
        <Badge variant="secondary" className="text-xs">
          {formatFollowers(connection.followerCount)}
        </Badge>
      )}
    </div>
  );
}

function AccountSelector({
  accounts,
  selectedId,
  onChange,
}: {
  accounts: Array<{ id: string; name: string; avatarUrl?: string }>;
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const selected = accounts.find(a => a.id === selectedId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          {selected?.name}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id}
            onClick={() => onChange(account.id)}
            className="flex items-center gap-2"
          >
            {account.avatarUrl && (
              <Avatar className="h-5 w-5">
                <AvatarImage src={account.avatarUrl} />
                <AvatarFallback>{account.name[0]}</AvatarFallback>
              </Avatar>
            )}
            {account.name}
            {account.id === selectedId && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatFollowers(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/components/platform-selector.tsx` |

---

## Acceptance Criteria

- [ ] Shows all 4 platforms (YouTube, TikTok, Instagram, Facebook)
- [ ] Connected platforms show account name
- [ ] Connected platforms have toggle switch
- [ ] Unconnected platforms show "Connect" button
- [ ] Connect redirects to OAuth flow
- [ ] Expired connections show warning icon
- [ ] Multiple accounts show account selector
- [ ] Enabled platforms are visually highlighted
- [ ] Follower count badge shows formatted number

---

## Test Plan

### Unit Tests
- [ ] Test follower count formatting
- [ ] Test connection status display

### Integration Tests
- [ ] Test toggle state changes

---

## Accessibility

- Toggle switches are keyboard accessible
- Warning icons have tooltips
- Dropdown menus support arrow key navigation
- Focus states are visible
