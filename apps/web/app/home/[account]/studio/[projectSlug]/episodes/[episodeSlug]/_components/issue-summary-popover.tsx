'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Heart,
  HelpCircle,
  Loader2,
  RefreshCw,
  Shield,
  Swords,
  XCircle,
} from 'lucide-react';

import type {
  CanonDashboardData,
  NarrativeThread,
  NarrativeThreadType,
} from '@kit/episodes/lib';
import { getCanonHealthAction } from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Separator } from '@kit/ui/separator';

interface IssueSummaryBadgeProps {
  projectId: string;
  className?: string;
}

type HealthStatus = 'ok' | 'warning' | 'error' | 'loading' | 'unknown';

const THREAD_TYPE_CONFIG: Record<
  NarrativeThreadType,
  { icon: typeof BookOpen; label: string }
> = {
  plot: { icon: BookOpen, label: 'Plot' },
  character: { icon: BookOpen, label: 'Character' },
  mystery: { icon: HelpCircle, label: 'Mystery' },
  romantic: { icon: Heart, label: 'Romantic' },
  conflict: { icon: Swords, label: 'Conflict' },
  thematic: { icon: Shield, label: 'Thematic' },
};

/**
 * Issue Summary Badge with Popover
 *
 * Replaces the old CanonHealthBadge tooltip with a clickable popover
 * that shows the full list of orphaned narrative threads with details
 * and action buttons. Gives users visibility into what the issues are.
 */
export function IssueSummaryBadge({
  projectId,
  className,
}: IssueSummaryBadgeProps) {
  const [status, setStatus] = useState<HealthStatus>('loading');
  const [dashboardData, setDashboardData] = useState<CanonDashboardData | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkCanonHealth = useCallback(async () => {
    try {
      const result = await getCanonHealthAction({ projectId });

      if (!result) {
        setStatus('ok');
        setDashboardData(null);
        return;
      }

      setDashboardData(result);

      if (result.health.status === 'ok') {
        setStatus('ok');
      } else if (result.health.status === 'warning') {
        setStatus('warning');
      } else {
        setStatus('error');
      }
    } catch (error) {
      console.error('Error checking canon health:', error);
      setStatus('unknown');
      setDashboardData(null);
    }
  }, [projectId]);

  useEffect(() => {
    checkCanonHealth();
  }, [checkCanonHealth]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await checkCanonHealth();
    setIsRefreshing(false);
  }, [checkCanonHealth]);

  const issueCount = dashboardData?.health.issueCount ?? 0;
  const orphanedThreads = dashboardData?.orphanedThreads ?? [];

  // Don't render during initial load
  if (status === 'loading') {
    return (
      <Badge variant="secondary" className={`gap-1 ${className ?? ''}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Checking…</span>
      </Badge>
    );
  }

  // All good - compact display
  if (status === 'ok') {
    return (
      <Badge
        variant="secondary"
        className={`cursor-default gap-1 ${className ?? ''}`}
      >
        <CheckCircle2 className="h-3 w-3 text-green-600" />
        <span className="text-xs">Canon OK</span>
      </Badge>
    );
  }

  // Unknown - can't check
  if (status === 'unknown') {
    return (
      <Badge
        variant="outline"
        className={`cursor-default gap-1 ${className ?? ''}`}
      >
        <HelpCircle className="h-3 w-3 text-gray-500" />
        <span className="text-xs">Unknown</span>
      </Badge>
    );
  }

  // Warnings or Errors - show clickable badge with popover
  const isError = status === 'error';
  const StatusIcon = isError ? XCircle : AlertTriangle;
  const statusColor = isError ? 'text-red-500' : 'text-amber-500';
  const badgeVariant = isError
    ? ('destructive' as const)
    : ('outline' as const);
  const badgeLabel = `${issueCount} issue${issueCount > 1 ? 's' : ''} detected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="focus:outline-none">
          <Badge
            variant={badgeVariant}
            className={`cursor-pointer gap-1 transition-all hover:shadow-md ${
              isError
                ? ''
                : 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400'
            } ${className ?? ''}`}
          >
            <StatusIcon className={`h-3 w-3 ${statusColor}`} />
            <span className="text-xs">{badgeLabel}</span>
          </Badge>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        className="w-[420px] p-0"
        sideOffset={8}
      >
        <IssuePopoverContent
          status={status}
          issueCount={issueCount}
          orphanedThreads={orphanedThreads}
          stats={dashboardData?.stats ?? null}
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Popover inner content
// ---------------------------------------------------------------------------

interface IssuePopoverContentProps {
  status: 'warning' | 'error';
  issueCount: number;
  orphanedThreads: NarrativeThread[];
  stats: CanonDashboardData['stats'] | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function IssuePopoverContent({
  status,
  issueCount,
  orphanedThreads,
  stats,
  isRefreshing,
  onRefresh,
}: IssuePopoverContentProps) {
  const isError = status === 'error';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {isError ? (
            <XCircle className="h-4 w-4 text-red-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            Canon Health
          </span>
          <Badge
            variant={isError ? 'destructive' : 'outline'}
            className={`text-[10px] ${
              isError
                ? ''
                : 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400'
            }`}
          >
            {issueCount} {isError ? 'Error' : 'Warning'}
            {issueCount > 1 ? 's' : ''}
          </Badge>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#1A1A1A] dark:hover:text-gray-300"
          title="Re-check canon health"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      <Separator />

      {/* Issue explanation */}
      <div className="px-4 py-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {isError
            ? 'Critical: Too many stale narrative threads. These may cause plot holes or confuse the story generation AI.'
            : "Some narrative threads have gone stale — they haven't been progressed or resolved in several episodes."}
        </p>
      </div>

      {/* Thread list */}
      {orphanedThreads.length > 0 ? (
        <ScrollArea className="max-h-[280px]">
          <div className="space-y-1 px-2 pb-2">
            {orphanedThreads.map((thread) => (
              <OrphanedThreadCard key={thread.id} thread={thread} />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            No thread details available.
          </p>
        </div>
      )}

      <Separator />

      {/* Stats footer */}
      {stats && (
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
            <span>{stats.immutableEvents} canon events</span>
            <span>•</span>
            <span>{stats.activeThreads} active threads</span>
            <span>•</span>
            <span>Ep {stats.lastEpisode}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual thread card
// ---------------------------------------------------------------------------

interface OrphanedThreadCardProps {
  thread: NarrativeThread;
}

function OrphanedThreadCard({ thread }: OrphanedThreadCardProps) {
  const typeConfig =
    THREAD_TYPE_CONFIG[thread.threadType] ?? THREAD_TYPE_CONFIG.plot;
  const TypeIcon = typeConfig.icon;

  const timeAgo = thread.createdAt
    ? formatDistanceToNow(new Date(thread.createdAt), { addSuffix: true })
    : '';

  const promiseCount = thread.promises?.length ?? 0;

  return (
    <div className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-[#141414]">
      <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-100/80 dark:bg-amber-900/20">
        <TypeIcon className="h-3 w-3 text-amber-600 dark:text-amber-400" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {thread.threadName}
          </span>
          <Badge
            variant="outline"
            className="flex-shrink-0 border-gray-200 px-1 py-0 text-[9px] text-gray-500 dark:border-gray-700 dark:text-gray-400"
          >
            {typeConfig.label}
          </Badge>
        </div>

        {thread.description && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-500 dark:text-gray-400">
            {thread.description}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
          {thread.openedEpisode && (
            <>
              <span className="font-medium text-gray-500 dark:text-gray-400">
                Ep {thread.openedEpisode.number}: {thread.openedEpisode.title}
              </span>
              {timeAgo && <span>•</span>}
            </>
          )}
          {timeAgo && <span>Opened {timeAgo}</span>}
          {promiseCount > 0 && (
            <>
              <span>•</span>
              <span>
                {promiseCount} promise{promiseCount > 1 ? 's' : ''}
              </span>
            </>
          )}
          {thread.status === 'open' && (
            <>
              <span>•</span>
              <span className="text-amber-500">Stale</span>
            </>
          )}
        </div>
      </div>

      <ChevronRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-gray-600" />
    </div>
  );
}
