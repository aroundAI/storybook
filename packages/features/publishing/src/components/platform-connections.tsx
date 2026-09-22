'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  BarChart3,
  CheckCircle,
  Clock,
  Facebook,
  Globe,
  Instagram,
  Plus,
  RefreshCw,
  Trash2,
  Youtube,
} from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';
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
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import type {
  AnalyticsAccess,
  AnalyticsAccessEntry,
} from '../oauth/analytics-scopes';
import {
  disconnectPlatformAction,
  getConnectionsAction,
  refreshConnectionAction,
  updateConnectionLanguageAction,
} from '../server/connection-actions';
import type {
  ConnectionStatus,
  PlatformConfig,
  PlatformConnection,
  PlatformType,
} from '../types';

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
  </svg>
);

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  bn: 'Bengali',
};

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    color: 'text-red-500',
    description: 'Publish to YouTube channels',
    scopes: ['Upload videos', 'Manage playlists', 'View analytics'],
    multiAccount: true,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    color: 'text-black dark:text-white',
    description: 'Publish to TikTok',
    scopes: ['Post videos', 'View insights'],
    multiAccount: false,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: 'text-pink-500',
    description: 'Publish Reels to Instagram Business',
    scopes: ['Post Reels', 'View insights'],
    multiAccount: true,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: 'text-blue-600',
    description: 'Publish to Facebook Pages',
    scopes: ['Post videos', 'Manage pages', 'View insights'],
    multiAccount: true,
  },
];

interface PlatformConnectionsProps {
  accountSlug: string;
  accountId: string;
}

export function PlatformConnections({
  accountSlug,
  accountId,
}: PlatformConnectionsProps) {
  const { data: connections, isLoading } = useQuery({
    queryKey: ['platform-connections', accountId],
    queryFn: async () => {
      const result = await getConnectionsAction({ accountId });
      // Add accountSlug to each connection
      return result.map((conn) => ({ ...conn, accountSlug }));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        {PLATFORMS.map((platform) => (
          <Card key={platform.id}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-6 rounded" />
                <div>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="mt-1 h-4 w-40" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {PLATFORMS.map((platform) => {
        const platformConnections =
          connections?.filter((c) => c.platform === platform.id) ?? [];

        return (
          <PlatformCard
            key={platform.id}
            platform={platform}
            connections={platformConnections}
            accountSlug={accountSlug}
            accountId={accountId}
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
  accountId: string;
}

function PlatformCard({
  platform,
  connections,
  accountSlug,
  accountId,
}: PlatformCardProps) {
  const Icon = getPlatformIcon(platform.id);

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
            <Plus className="mr-2 h-4 w-4" />
            <Trans
              i18nKey={
                platform.multiAccount && connections.length > 0
                  ? 'platforms:connectAnother'
                  : 'platforms:connect'
              }
              defaults={
                platform.multiAccount && connections.length > 0
                  ? 'Connect Another'
                  : 'Connect'
              }
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            <p>
              <Trans
                i18nKey="platforms:noAccountsConnected"
                defaults="No {platform} accounts connected"
                values={{ platform: platform.name }}
              />
            </p>
            <p className="mt-1 text-sm">
              <Trans
                i18nKey="platforms:connectToStart"
                defaults="Connect an account to start publishing"
              />
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                platform={platform}
                accountId={accountId}
              />
            ))}
          </div>
        )}

        <div className="mt-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            <strong>
              <Trans
                i18nKey="platforms:permissionsRequested"
                defaults="Permissions requested:"
              />
            </strong>{' '}
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
  accountId: string;
}

function ConnectionRow({
  connection,
  platform,
  accountId,
}: ConnectionRowProps) {
  const [showDisconnect, setShowDisconnect] = useState(false);
  const queryClient = useQueryClient();

  const refreshMutation = useMutation({
    mutationFn: () => refreshConnectionAction({ connectionId: connection.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['platform-connections', accountId],
      });
      toast.success('Token refreshed successfully');
    },
    onError: () => {
      toast.error('Failed to refresh token. Please try reconnecting.');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () =>
      disconnectPlatformAction({
        connectionId: connection.id,
        platform: connection.platform,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['platform-connections', accountId],
      });
      setShowDisconnect(false);
      toast.success('Account disconnected');
    },
    onError: () => {
      toast.error('Failed to disconnect account. Please try again.');
    },
  });

  const languageMutation = useMutation({
    mutationFn: (language: string) =>
      updateConnectionLanguageAction({
        connectionId: connection.id,
        language,
      }),
    onSuccess: (_, language) => {
      queryClient.invalidateQueries({
        queryKey: ['platform-connections', accountId],
      });
      toast.success(
        `Language set to ${LANGUAGE_NAMES[language as keyof typeof LANGUAGE_NAMES] ?? language}`,
      );
    },
    onError: () => {
      toast.error('Failed to update language');
    },
  });

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
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
              <ConnectionStatusBadge status={connection.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {connection.createdAt &&
              !isNaN(new Date(connection.createdAt).getTime()) ? (
                <Trans
                  i18nKey="platforms:connectedTimeAgo"
                  defaults="Connected {time}"
                  values={{
                    time: formatDistanceToNow(new Date(connection.createdAt), {
                      addSuffix: true,
                    }),
                  }}
                />
              ) : (
                <Trans i18nKey="platforms:connected" defaults="Connected" />
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <Select
            value={connection.language ?? 'en'}
            onValueChange={(value) => languageMutation.mutate(value)}
            disabled={languageMutation.isPending}
          >
            <SelectTrigger
              className="w-[130px]"
              title="Target language for this channel"
            >
              <Globe className="mr-1 h-3 w-3" />
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {connection.status === 'expired' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => initiateOAuth(platform.id, connection.accountSlug)}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              <Trans i18nKey="platforms:reconnect" defaults="Reconnect" />
            </Button>
          )}

          {connection.status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              title="Refresh token"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`}
              />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDisconnect(true)}
            title="Disconnect"
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

      {connection.analyticsAccess && (
        <AnalyticsAccessNotice
          connectionId={connection.id}
          access={connection.analyticsAccess}
          platformName={platform.name}
          onReconnect={() => initiateOAuth(platform.id, connection.accountSlug)}
        />
      )}

      <AlertDialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans
                i18nKey="platforms:disconnectTitle"
                defaults="Disconnect {platform}?"
                values={{ platform: platform.name }}
              />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                i18nKey="platforms:disconnectDescription"
                defaults="This will remove access to {accountName}. You won't be able to publish to this account until you reconnect."
                values={{ accountName: connection.accountName }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans i18nKey="common:cancel" defaults="Cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trans i18nKey="platforms:disconnect" defaults="Disconnect" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Says what this connection's analytics cannot reach, and who can change it.
 *
 * Silent when everything is authorised, and silent about a platform nothing
 * reads yet. Each line names what would be gained, because "reconnect for
 * analytics" gives nobody a reason to.
 */
function AnalyticsAccessNotice({
  connectionId,
  access,
  platformName,
  onReconnect,
}: {
  connectionId: string;
  access: AnalyticsAccess;
  platformName: string;
  onReconnect: () => void;
}) {
  const unreachable = access.entries.filter(
    (entry) => entry.state !== 'authorised' && entry.state !== 'no_provider',
  );

  if (unreachable.length === 0) return null;

  return (
    <Alert
      className="mt-2"
      data-test="analytics-access-notice"
      data-connection-id={connectionId}
      data-access={access.summary}
    >
      <BarChart3 className="h-4 w-4" />
      <AlertDescription>
        <p className="font-medium text-foreground">
          <Trans
            i18nKey={`platforms:analyticsAccess.title.${access.summary}`}
            defaults={
              access.summary === 'unknown'
                ? 'We have no record of what this connection may read'
                : 'Some analytics are not authorised on this connection'
            }
          />
        </p>
        <ul className="mt-1 space-y-1">
          {unreachable.map((entry) => (
            <li
              key={entry.requirementId}
              data-test="analytics-access-entry"
              data-requirement={entry.requirementId}
              data-state={entry.state}
            >
              <span className="font-medium">{entry.gains}.</span>{' '}
              <AnalyticsAccessReason
                entry={entry}
                platformName={platformName}
              />
            </li>
          ))}
        </ul>
        {access.canReconnect && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            data-test="analytics-reconnect"
            onClick={onReconnect}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            <Trans
              i18nKey={`platforms:analyticsAccess.reconnect.${access.summary}`}
              defaults={
                access.summary === 'unknown'
                  ? 'Reconnect {platform}'
                  : 'Reconnect {platform} to grant access'
              }
              values={{ platform: platformName }}
            />
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function AnalyticsAccessReason({
  entry,
  platformName,
}: {
  entry: AnalyticsAccessEntry;
  platformName: string;
}) {
  switch (entry.state) {
    case 'scope_missing':
      return (
        <Trans
          i18nKey="platforms:analyticsAccess.reason.scope_missing"
          defaults="This connection was made before we asked {platform} for it. Reconnect to grant it."
          values={{ platform: platformName }}
        />
      );
    case 'review_pending':
      return (
        <Trans
          i18nKey="platforms:analyticsAccess.reason.review_pending"
          defaults="{platform} has to approve our app before anyone can grant this. Nothing for you to do, and reconnecting will not change it."
          values={{ platform: platformName }}
        />
      );
    case 'account_type_gated':
      return <>{entry.resolution}</>;
    case 'unknown':
      return (
        <Trans
          i18nKey="platforms:analyticsAccess.reason.unknown"
          defaults="Reconnect and we will record what {platform} allows."
          values={{ platform: platformName }}
        />
      );
    default:
      return null;
  }
}

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const variants = {
    active: {
      icon: CheckCircle,
      label: 'Connected',
      i18nKey: 'platforms:status.connected',
      className:
        'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    },
    expired: {
      icon: Clock,
      label: 'Expired',
      i18nKey: 'platforms:status.expired',
      className:
        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    },
    error: {
      icon: AlertCircle,
      label: 'Error',
      i18nKey: 'platforms:status.error',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
  };

  // Defensive check for unknown status values
  const variant = variants[status] ?? variants.error;
  const { icon: Icon, label, i18nKey, className } = variant;

  return (
    <Badge variant="outline" className={className}>
      <Icon className="mr-1 h-3 w-3" />
      <Trans i18nKey={i18nKey} defaults={label} />
    </Badge>
  );
}

function getPlatformIcon(platform: PlatformType) {
  switch (platform) {
    case 'youtube':
      return Youtube;
    case 'tiktok':
      return TikTokIcon;
    case 'instagram':
      return Instagram;
    case 'facebook':
      return Facebook;
    default:
      return Youtube;
  }
}

function initiateOAuth(platform: PlatformType, accountSlug: string) {
  // Map platform to API route
  const routePlatform =
    platform === 'instagram' || platform === 'facebook' ? 'meta' : platform;
  window.location.href = `/api/platforms/connect/${routePlatform}?account=${encodeURIComponent(accountSlug)}`;
}
