'use client';

import { format } from 'date-fns';
import { Film, ListOrdered, Settings2, Smartphone } from 'lucide-react';

import { Button } from '@kit/ui/button';

import {
  QUEUE_WARNING_DAYS,
  type ReleasePreview,
  itemKeyOfTarget,
} from '../lib/cadence/release-types';

/**
 * FILM-719, FILM-2209. A cadence release as it will land: each channel's
 * posts in order, and its Shorts queue: how many wait, until when, and how
 * far that runs past the channel's long videos.
 */
export function ReleaseCalendar(props: {
  preview: ReleasePreview;
  /** The schedule item a target came from, by its item key */
  labelOf: (itemKey: string) => { label: string; full: boolean };
  onEditChannel?: (connectionId: string) => void;
}) {
  const { preview } = props;

  return (
    <div className="space-y-4" data-test="release-calendar">
      {preview.channels.map((channel) => {
        const placed = preview.placed
          .filter((post) => post.connectionId === channel.connectionId)
          .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        const queue = preview.shortsQueue.find(
          (q) => q.connectionId === channel.connectionId,
        );

        return (
          <div
            key={channel.connectionId}
            className="rounded-lg border bg-background p-3"
            data-test="release-calendar-channel"
            data-connection-id={channel.connectionId}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{channel.name}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="capitalize">{channel.platform}</span>
                  {channel.queueEndsAt && (
                    <>
                      {' · '}booked until{' '}
                      {format(new Date(channel.queueEndsAt), 'EEE d MMM')}
                    </>
                  )}
                </p>
              </div>
              {props.onEditChannel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-test="release-calendar-edit-channel"
                  onClick={() => props.onEditChannel?.(channel.connectionId)}
                >
                  <Settings2 className="mr-1 h-4 w-4" />
                  Posting rules
                </Button>
              )}
            </div>

            <ol className="space-y-2">
              {placed.map((post) => {
                const item = props.labelOf(itemKeyOfTarget(post.key));

                return (
                  <li
                    key={post.key}
                    className="flex items-start gap-2 text-sm"
                    data-test="release-calendar-post"
                    data-key={post.key}
                    data-scheduled-at={post.scheduledAt}
                  >
                    {item.full ? (
                      <Film className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-pink-500" />
                    )}
                    <div className="min-w-0">
                      <p className="break-words">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(
                          new Date(post.scheduledAt),
                          'EEE d MMM, h:mm a',
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {queue?.lastShortAt && (
              <div
                className={
                  queue.runsAhead
                    ? 'mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground'
                }
                data-test="release-calendar-shorts-queue"
                data-queued={queue.queued}
                data-days-ahead={queue.daysAhead ?? ''}
              >
                <p className="flex items-center gap-1">
                  <ListOrdered className="h-3.5 w-3.5" />
                  {queue.queued} Short{queue.queued === 1 ? '' : 's'} queued,
                  the last on {format(new Date(queue.lastShortAt), 'EEE d MMM')}
                  {queue.daysAhead !== null &&
                    `, ${queue.daysAhead} day${queue.daysAhead === 1 ? '' : 's'} after the last long video`}
                </p>
                {queue.runsAhead && (
                  <p
                    className="mt-1"
                    data-test="release-calendar-queue-warning"
                  >
                    The Shorts queue runs more than {QUEUE_WARNING_DAYS} days
                    past the last long video, and grows with each episode: there
                    are more Shorts per episode than Short slots between long
                    videos. Add Short times, or post long videos less often.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
