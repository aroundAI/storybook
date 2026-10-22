'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { CalendarX, History, Loader2 } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { PLATFORM_NAMES, isPlatform } from '@kit/publishing/lib/platforms';
import { timeZoneLabel } from '@kit/publishing/lib/time-zone-label';
import {
  cancelScheduledPublishAction,
  discardHeldShortsAction,
  markPublishRemovedAction,
  requeueHeldShortsAction,
} from '@kit/publishing/server';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { ChangeTimeDialog } from './change-time-dialog';
import { type ScheduleRow, StatusCell, formatAt } from './schedule-status-cell';

export type { ScheduleRow };

const noSubscription = () => () => {};

/** The viewer's zone: null while the server renders, which has none */
function useViewerTimeZone() {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    () => null,
  );
}

/**
 * FILM-2211. Every post of the project in the range, in time order, in the
 * viewer's timezone. A scheduled post's time can be changed in place
 * (FILM-2213) or it can be cancelled, and a held Short
 * re-queued or discarded, through the actions the Publish screen uses. A
 * published video taken down on its platform can be marked removed
 * (KB-207), which frees its place in the channel's posting rules.
 */
export function ScheduleTable(props: {
  rows: ScheduleRow[];
  episodesHref: string;
  from: string;
  to: string;
}) {
  const timeZone = useViewerTimeZone();

  if (props.rows.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center"
        data-test="schedule-empty"
      >
        <CalendarX className="h-6 w-6 text-muted-foreground" />
        <p className="font-medium">Nothing in this range</p>
        <p className="text-sm text-muted-foreground">
          No post matches these filters between {props.from} and {props.to}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table data-test="schedule-table">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap" data-test="schedule-when">
              When{timeZone ? ` (${timeZoneLabel(timeZone)})` : ''}
            </TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Episode</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <TableRow
              key={row.publishId}
              data-test="schedule-row"
              data-publish-id={row.publishId}
              data-status={row.status}
              data-type={row.contentType === 'short' ? 'short' : 'long'}
              data-platform={row.platform}
              data-at={row.at ?? ''}
              data-episode-deleted={row.episodeDeleted}
              data-youtube-alert={row.youtube?.alert ?? undefined}
              className={
                row.youtube?.staged && row.youtube.alert
                  ? 'bg-amber-50 dark:bg-amber-950/30'
                  : undefined
              }
            >
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.at ? (
                  <time dateTime={row.at} data-test="schedule-row-time">
                    {timeZone ? formatAt(row.at, timeZone) : ''}
                  </time>
                ) : (
                  <span className="text-muted-foreground">No time yet</span>
                )}
                <MovedFrom row={row} timeZone={timeZone} />
              </TableCell>
              <TableCell>
                {isPlatform(row.platform)
                  ? PLATFORM_NAMES[row.platform]
                  : row.platform}
              </TableCell>
              <TableCell>{row.channelName ?? '—'}</TableCell>
              <TableCell>
                <Link
                  href={`${props.episodesHref}/${row.episodeSlug ?? row.episodeId}/publish`}
                  className="underline-offset-4 hover:underline"
                  data-test="schedule-row-episode"
                >
                  {row.episodeNumber !== null ? `Ep ${row.episodeNumber}` : ''}
                  {row.episodeNumber !== null && row.episodeTitle ? ' · ' : ''}
                  {row.episodeTitle}
                </Link>
                {row.episodeDeleted && (
                  <Badge
                    variant="outline"
                    className="ml-1"
                    data-test="schedule-row-episode-deleted"
                  >
                    Deleted
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                {row.contentType === 'short' ? 'Short' : 'Long video'}
              </TableCell>
              <TableCell className="max-w-64 truncate" title={row.title ?? ''}>
                {row.title ?? '—'}
              </TableCell>
              <TableCell>
                <StatusCell row={row} timeZone={timeZone} />
              </TableCell>
              <TableCell className="text-right">
                <RowActions row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const VIA = { ui: 'on this page', mcp: 'over MCP', replan: 'by a re-plan' };

/** FILM-2213: "Moved from <time>", every change in its tooltip */
function MovedFrom(props: { row: ScheduleRow; timeZone: string | null }) {
  const history = props.row.scheduleHistory ?? [];
  const first = history[0];
  const { timeZone } = props;

  if (!first || !timeZone) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground"
            data-test="schedule-row-moved"
            data-moves={history.length}
            tabIndex={0}
          >
            <History className="h-3 w-3" />
            Moved from {formatAt(first.from, timeZone)}
            {props.row.manualTime ? ' · outside the rules' : ''}
          </span>
        </TooltipTrigger>
        <TooltipContent data-test="schedule-row-history">
          <ul className="space-y-1 text-xs">
            {history.map((entry) => (
              <li key={entry.at}>
                {formatAt(entry.from, timeZone)} →{' '}
                {formatAt(entry.to, timeZone)}, {VIA[entry.via]}
                {entry.note ? `: ${entry.note}` : ''}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type Pending = 'cancel' | 'requeue' | 'discard' | 'remove';

const CONFIRM: Record<
  Pending,
  { title: string; body: string; action: string; done: string }
> = {
  cancel: {
    title: 'Cancel this post?',
    body: 'It is taken off the schedule and does not go out. Its slot is freed for the next post.',
    action: 'Cancel post',
    done: 'Post cancelled.',
  },
  requeue: {
    title: 'Re-queue this Short?',
    body: 'It goes to the end of its channel’s Shorts queue, at the channel’s next free Short time.',
    action: 'Re-queue',
    done: 'Short re-queued.',
  },
  discard: {
    title: 'Discard this Short?',
    body: 'Its draft is deleted and it is never posted.',
    action: 'Discard',
    done: 'Short discarded.',
  },
  remove: {
    title: 'Mark this video as removed?',
    body: 'For a video already taken down on the platform. It no longer counts toward the channel’s posting rules, and analytics stop reading it. Nothing is deleted on the platform.',
    action: 'Mark as removed',
    done: 'Marked as removed.',
  },
};

const LABELS: Record<Pending, string> = {
  cancel: 'Cancel',
  requeue: 'Re-queue',
  discard: 'Discard',
  remove: 'Mark as removed',
};

function RowActions({ row }: { row: ScheduleRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [changingTime, setChangingTime] = useState(false);
  const [running, startTransition] = useTransition();

  const actions: Pending[] =
    row.status === 'scheduled'
      ? ['cancel']
      : row.status === 'held'
        ? ['requeue', 'discard']
        : row.status === 'published'
          ? ['remove']
          : [];

  if (actions.length === 0) return null;

  const run = (action: Pending) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const publishIds = [row.publishId];

    startTransition(async () => {
      try {
        if (action === 'cancel') {
          await unwrap(
            cancelScheduledPublishAction({ publishId: row.publishId }),
          );
        } else if (action === 'remove') {
          await unwrap(markPublishRemovedAction({ publishId: row.publishId }));
        } else if (action === 'requeue') {
          await unwrap(requeueHeldShortsAction({ publishIds, timezone }));
        } else {
          await unwrap(discardHeldShortsAction({ publishIds, timezone }));
        }

        toast.success(CONFIRM[action].done);
        setConfirming(null);
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'That did not work. Try again.'));
        setConfirming(null);
      }
    });
  };

  const copy = confirming ? CONFIRM[confirming] : null;

  return (
    <div className="flex justify-end gap-1">
      {row.status === 'scheduled' && (
        <Button
          size="sm"
          variant="outline"
          disabled={running}
          onClick={() => setChangingTime(true)}
          data-test="schedule-row-change-time"
        >
          Change time
        </Button>
      )}
      {changingTime && (
        <ChangeTimeDialog row={row} onClose={() => setChangingTime(false)} />
      )}
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === 'requeue' ? 'outline' : 'ghost'}
          disabled={running}
          onClick={() => setConfirming(action)}
          data-test={`schedule-row-${action}`}
        >
          {LABELS[action]}
        </Button>
      ))}

      <AlertDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !running && setConfirming(null)}
      >
        {copy && confirming && (
          <AlertDialogContent data-test="schedule-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>{copy.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {row.title ?? 'This post'}: {copy.body}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={running}>Keep it</AlertDialogCancel>
              <Button
                variant={confirming === 'requeue' ? 'default' : 'destructive'}
                disabled={running}
                onClick={() => run(confirming)}
                data-test="schedule-confirm-action"
              >
                {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {copy.action}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
