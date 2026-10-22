'use client';

import { ExternalLink, Zap } from 'lucide-react';

import {
  scheduleStatusOf,
  youtubeStagingLine,
} from '@kit/publishing/lib/schedule-view';
import { Badge } from '@kit/ui/badge';

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
  /** KB-214: a YouTube post uploaded ahead of its time */
  youtube: {
    staged: boolean;
    goLiveWhenReady: boolean;
    publishAt: string;
    delays: readonly unknown[];
    alert: string | null;
    error: string | null;
  } | null;
}

const TONES = {
  neutral: 'outline',
  success: 'success',
  danger: 'destructive',
  warning: 'warning',
} as const;

export function formatAt(at: string, timeZone: string) {
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
 * A post's status on the Schedule tab: its badge, breaking, its link, and
 * why it failed, was held or removed. KB-214: a YouTube post uploaded ahead
 * of its time says when it goes public and whether the HD gate held it.
 */
export function StatusCell({
  row,
  timeZone,
}: {
  row: ScheduleRow;
  timeZone: string | null;
}) {
  const status = scheduleStatusOf(row.status);
  const staging = youtubeStagingLine(row.youtube, (at) =>
    timeZone ? formatAt(at, timeZone) : at,
  );

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
      {staging && (
        <p
          className={
            staging.alert
              ? 'max-w-64 text-xs font-medium text-amber-700 dark:text-amber-400'
              : 'max-w-64 text-xs text-muted-foreground'
          }
          data-test="schedule-row-youtube"
        >
          {staging.text}
        </p>
      )}
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
