'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { CalendarX, ExternalLink, Loader2, Zap } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { PLATFORM_NAMES, isPlatform } from '@kit/publishing/lib/platforms';
import { scheduleStatusOf } from '@kit/publishing/lib/schedule-view';
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

export interface ScheduleRow {
  publishId: string;
  episodeId: string;
  episodeTitle: string | null;
  episodeNumber: number | null;
  episodeSlug: string | null;
  platform: string;
  channelName: string | null;
  contentType: string;
  title: string | null;
  status: string;
  at: string | null;
  platformUrl: string | null;
  error: string | null;
  heldReason: string | null;
  breaking: boolean;
  episodeDeleted: boolean;
  removedReason: string | null;
}

const TONES = {
  neutral: 'outline',
  success: 'success',
  danger: 'destructive',
  warning: 'warning',
} as const;

const noSubscription = () => () => {};

/** The viewer's zone: null while the server renders, which has none */
function useViewerTimeZone() {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    () => null,
  );
}

function formatAt(at: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
}

/**
 * FILM-2211. Every post of the project in the range, in time order, in the
 * viewer's timezone. A scheduled post can be cancelled, and a held Short
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
            >
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.at ? (
                  <time dateTime={row.at} data-test="schedule-row-time">
                    {timeZone ? formatAt(row.at, timeZone) : ''}
                  </time>
                ) : (
                  <span className="text-muted-foreground">No time yet</span>
                )}
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
                <StatusCell row={row} />
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

function StatusCell({ row }: { row: ScheduleRow }) {
  const status = scheduleStatusOf(row.status);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={TONES[status.tone]} data-test="schedule-row-status">
          {status.label}
        </Badge>
        {row.breaking && (
          <Badge variant="info" data-test="schedule-row-breaking">
            <Zap className="mr-0.5 h-3 w-3" />
            Breaking
          </Badge>
        )}
        {row.status === 'published' && row.platformUrl && (
          <a
            href={row.platformUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-xs underline-offset-4 hover:underline"
            data-test="schedule-row-link"
          >
            View
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {(row.error ?? row.heldReason ?? row.removedReason) && (
        <p
          className="max-w-64 text-xs text-muted-foreground"
          data-test="schedule-row-reason"
        >
          {row.error ?? row.heldReason ?? `Removed: ${row.removedReason}`}
        </p>
      )}
    </div>
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
