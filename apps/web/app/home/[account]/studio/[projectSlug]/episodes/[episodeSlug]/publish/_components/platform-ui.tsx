'use client';

import { AlertCircle, Facebook, Instagram, Youtube } from 'lucide-react';

import { describeFollowerCount } from '@kit/publishing/lib/follower-count';
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { PLATFORM_CONFIG, type PlatformConnection } from './publish-types';

// Platform icon component - uses lucide-react SVG icons with colored badges
export const PlatformIcon = ({
  platform,
  size = 'md',
}: {
  platform: string;
  size?: 'sm' | 'md' | 'lg';
}) => {
  const config = PLATFORM_CONFIG[platform];
  const sizeClasses = {
    sm: 'h-5 w-5',
    md: 'h-7 w-7',
    lg: 'h-8 w-8',
  };
  const iconSizeClasses = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4',
  };

  const IconComponent = () => {
    const iconClass = iconSizeClasses[size];
    switch (platform) {
      case 'youtube':
        return <Youtube className={iconClass} />;
      case 'facebook':
        return <Facebook className={iconClass} />;
      case 'instagram':
        return <Instagram className={iconClass} />;
      case 'tiktok':
        // Lucide doesn't have TikTok icon, use text fallback
        return <span className="text-[9px] font-bold">TT</span>;
      case 'twitter':
        return <span className="text-[10px] font-bold">X</span>;
      default:
        return (
          <span className="text-[9px] font-bold">
            {platform.slice(0, 2).toUpperCase()}
          </span>
        );
    }
  };

  return (
    <div
      className={`flex items-center justify-center rounded-lg ${sizeClasses[size]} ${config?.bgColor || 'bg-gray-500'} ${config?.textColor || 'text-white'}`}
    >
      <IconComponent />
    </div>
  );
};

// Channel badge component
export const ChannelBadge = ({
  conn,
  size = 'sm',
}: {
  conn: PlatformConnection;
  size?: 'sm' | 'md';
}) => {
  const config = PLATFORM_CONFIG[conn.platform];

  // Null means no count exists — never captured, or hidden by the owner —
  // so nothing is shown rather than a 0 that would read as measured.
  const followers =
    conn.followerCount != null
      ? describeFollowerCount({
          count: conn.followerCount,
          source: conn.followerCountSource,
          asOf: conn.followerCountAsOf,
          roundingStep: conn.followerCountRoundingStep,
        })
      : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-test="channel-badge"
            data-platform={conn.platform}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 ${size === 'md' ? 'px-3 py-1.5' : ''} ${conn.tokenValid ? 'border-gray-200 bg-card' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}
          >
            <Avatar className={size === 'md' ? 'h-5 w-5' : 'h-4 w-4'}>
              <AvatarImage src={conn.avatarUrl ?? undefined} />
              <AvatarFallback
                className={`${config?.bgColor} text-[10px] text-white`}
              >
                {config?.shortName}
              </AvatarFallback>
            </Avatar>
            <span
              className={`font-medium ${size === 'md' ? 'text-sm' : 'text-xs'}`}
            >
              {conn.platformAccountName}
            </span>
            {followers && size === 'md' ? (
              <span
                className={`text-xs ${followers.stale ? 'text-muted-foreground' : 'text-foreground/70'}`}
                data-test={'channel-follower-count'}
                data-stale={followers.stale}
              >
                {followers.short}
              </span>
            ) : null}
            {!conn.tokenValid && (
              <AlertCircle className="h-3 w-3 text-red-500" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {config?.name}: {conn.platformAccountName}
          </p>
          {followers ? <p>{followers.detail}</p> : null}
          {!conn.tokenValid && (
            <p className="text-red-400">Token expired - needs reconnection</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
