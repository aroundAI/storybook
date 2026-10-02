'use client';

import { useCallback } from 'react';

import {
  AlertCircle,
  Check,
  ChevronDown,
  Facebook,
  Instagram,
  Plus,
  Youtube,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Switch } from '@kit/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { describeFollowerCount } from '../lib/follower-count';
import { PLATFORM_CONFIG } from '../lib/platform-limits';
import { OFFERED_PLATFORMS } from '../lib/platforms';
import type {
  FollowerCountSource,
  Platform,
  PlatformPublishConfig,
  PlatformSelectorProps,
} from '../lib/types';

/**
 * TikTok icon (not included in lucide-react)
 */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

/**
 * X (Twitter) icon
 */
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<
  Platform,
  React.ComponentType<{ className?: string }>
> = {
  youtube: Youtube,
  tiktok: TikTokIcon,
  instagram: Instagram,
  facebook: Facebook,
  twitter: XIcon,
};

// Platform display order: the offered ones (X is hidden while `X_ENABLED`
// is off)
const PLATFORM_ORDER = OFFERED_PLATFORMS;

export function PlatformSelector({
  platforms,
  onToggle,
  onConnect,
  onAccountChange,
}: PlatformSelectorProps) {
  return (
    <TooltipProvider>
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3">
            {PLATFORM_ORDER.map((platformKey) => {
              const config = PLATFORM_CONFIG[platformKey];
              const platform = platforms.find(
                (p) => p.platform === platformKey,
              );
              const isConnected = !!platform;
              const isEnabled = platform?.enabled ?? false;

              return (
                <PlatformRow
                  key={platformKey}
                  platformKey={platformKey}
                  config={config}
                  platform={platform}
                  isConnected={isConnected}
                  isEnabled={isEnabled}
                  onToggle={(enabled) => onToggle(platformKey, enabled)}
                  onConnect={() => onConnect?.(platformKey)}
                  onAccountChange={(connectionId) =>
                    onAccountChange?.(platformKey, connectionId)
                  }
                />
              );
            })}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

interface PlatformRowProps {
  platformKey: Platform;
  config: (typeof PLATFORM_CONFIG)[Platform];
  platform?: PlatformPublishConfig;
  isConnected: boolean;
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  onConnect: () => void;
  onAccountChange: (connectionId: string) => void;
}

function PlatformRow({
  platformKey,
  config,
  platform,
  isConnected,
  isEnabled,
  onToggle,
  onConnect,
  onAccountChange,
}: PlatformRowProps) {
  const Icon = PLATFORM_ICONS[platformKey];
  const tokenExpired = platform && platform.tokenValid === false;

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (!tokenExpired) {
        onToggle(checked);
      }
    },
    [onToggle, tokenExpired],
  );

  return (
    <div
      className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
        isEnabled ? 'border-primary bg-primary/5' : 'border-border'
      }`}
      data-test={`platform-row-${platformKey}`}
    >
      <div className="flex items-center gap-3">
        {/* Platform Icon */}
        <div className={`rounded-lg p-2 ${config.bgColor}`}>
          <Icon className={`h-5 w-5 ${config.color}`} />
        </div>

        {/* Platform Info */}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{config.name}</span>
            {tokenExpired && (
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

          {isConnected && platform ? (
            <AccountInfo platform={platform} />
          ) : (
            <span className="text-sm text-muted-foreground">
              {config.description}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isConnected && platform ? (
          <>
            {/* Account Selector for multiple accounts */}
            {platform.accounts && platform.accounts.length > 1 && (
              <AccountSelector
                accounts={platform.accounts}
                selectedId={platform.connectionId}
                onChange={onAccountChange}
              />
            )}

            <Switch
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={tokenExpired}
              data-test={`platform-toggle-${platformKey}`}
            />
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onConnect}
            data-test={`platform-connect-${platformKey}`}
          >
            <Plus className="mr-1 h-4 w-4" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function AccountInfo({ platform }: { platform: PlatformPublishConfig }) {
  return (
    <div className="flex items-center gap-2">
      {platform.avatarUrl && (
        <Avatar className="h-5 w-5">
          <AvatarImage src={platform.avatarUrl} />
          <AvatarFallback>
            {platform.platformAccountName?.[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span className="text-sm text-muted-foreground">
        {platform.platformAccountName}
      </span>
      {platform.followerCount != null && (
        <FollowerBadge
          count={platform.followerCount}
          source={platform.followerCountSource ?? null}
          asOf={platform.followerCountAsOf ?? null}
          roundingStep={platform.followerCountRoundingStep ?? 0}
        />
      )}
    </div>
  );
}

/**
 * The follower count, dated. A figure stored at connection time is marked as
 * such rather than presented as current (FILM-1617).
 */
function FollowerBadge({
  count,
  source,
  asOf,
  roundingStep,
}: {
  count: number;
  source: FollowerCountSource | null;
  asOf: string | null;
  roundingStep: number;
}) {
  const display = describeFollowerCount({ count, source, asOf, roundingStep });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={display.stale ? 'outline' : 'secondary'}
          className={
            display.stale ? 'text-xs text-muted-foreground' : 'text-xs'
          }
          data-test={'follower-badge'}
        >
          {display.short}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{display.detail}</TooltipContent>
    </Tooltip>
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
  const selected = accounts.find((a) => a.id === selectedId);

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
            {account.id === selectedId && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
