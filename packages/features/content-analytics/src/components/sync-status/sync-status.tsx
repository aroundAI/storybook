'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { unwrap } from '../../lib/action-result';
import { platformLabel } from '../../lib/subscriber-total-note';
import { type SyncStatusView, describeSyncStatus } from '../../lib/sync-status';
import { getSyncStatusAction } from '../../server/sync-actions';

/**
 * KB-150. Where a creator reads their figures, when those figures were last
 * refreshed and why the latest sync failed, if it did — so figures that
 * stopped moving say why rather than looking like a quiet video.
 */

/** The sync records for some publishes, keyed by publish id. */
export function useSyncStatuses(
  input: { episodeId: string } | { publishIds: string[] },
) {
  const key =
    'episodeId' in input ? ['episode', input.episodeId] : input.publishIds;

  return useQuery({
    queryKey: ['analytics-sync-status', ...key],
    queryFn: async () =>
      (await unwrap(getSyncStatusAction(input))).map(describeSyncStatus),
    enabled: 'episodeId' in input || input.publishIds.length > 0,
  });
}

/** One episode's publishes: when each last synced, and any failure. */
export function EpisodeSyncStatus({ episodeId }: { episodeId: string }) {
  const query = useSyncStatuses({ episodeId });

  if (query.isLoading) {
    return <Skeleton className={'h-12 w-full'} />;
  }

  if (query.isError) {
    // Not "no sync record": the record could not be read.
    return (
      <p
        className={'text-sm text-muted-foreground'}
        role={'alert'}
        data-test={'sync-status-error'}
      >
        The analytics sync status could not be loaded.
      </p>
    );
  }

  const statuses = query.data ?? [];

  if (statuses.length === 0) return null;

  return (
    <section className={'flex flex-col gap-3'} data-test={'sync-status'}>
      {statuses.map((status) => (
        <SyncStatusRow key={status.publishId} status={status} />
      ))}
    </section>
  );
}

function SyncStatusRow({ status }: { status: SyncStatusView }) {
  const label = platformLabel(status.platform);

  return (
    <div
      className={'flex flex-col gap-2'}
      data-test={'sync-status-row'}
      data-platform={status.platform}
      data-state={status.state}
    >
      <p className={'text-sm text-muted-foreground'}>
        <span className={'font-medium text-foreground'}>{label}</span>
        {' · '}
        <LastSynced at={status.lastSyncedAt} />
      </p>

      {status.problem ? (
        <Alert variant={'warning'} data-test={'sync-status-failure'}>
          <AlertTriangle className={'h-4 w-4'} />
          <AlertTitle data-test={'sync-status-problem'}>
            {status.problem}
          </AlertTitle>
          <AlertDescription className={'flex flex-col gap-1'}>
            {status.reason ? (
              <span data-test={'sync-status-reason'}>
                Details: {status.reason}
              </span>
            ) : null}
            {status.next ? (
              <span data-test={'sync-status-next'}>{status.next}</span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function LastSynced({ at }: { at: string | null }) {
  if (!at) {
    return <span data-test={'sync-status-last-synced'}>Not synced yet</span>;
  }

  return (
    <span data-test={'sync-status-last-synced'} data-synced-at={at}>
      Figures last refreshed <time dateTime={at}>{formatSyncTime(at)}</time>
    </span>
  );
}

export function formatSyncTime(at: string) {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** The Video Log's row flag for a video whose latest sync did not land. */
export function SyncProblemBadge({ status }: { status: SyncStatusView }) {
  if (!status.problem) return null;

  const lastSynced = status.lastSyncedAt
    ? `Figures last refreshed ${formatSyncTime(status.lastSyncedAt)}.`
    : 'Not synced yet.';
  const detail = [
    status.problem,
    status.reason ? `Details: ${status.reason}` : null,
    status.next,
    lastSynced,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type={'button'}
            aria-label={detail}
            data-test={'video-log-sync-problem'}
            data-state={status.state}
          >
            <Badge
              variant={'outline'}
              className={
                'cursor-help border-orange-600/50 whitespace-nowrap text-orange-600 dark:border-orange-500 dark:text-orange-400'
              }
            >
              {status.state === 'failed' ? 'Sync failed' : 'Not collected'}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className={'max-w-xs text-sm'}>{detail}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
