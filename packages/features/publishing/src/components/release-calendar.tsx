'use client';

import { format } from 'date-fns';
import { Film, PauseCircle, Settings2, Smartphone } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';

import {
  type ReleasePreview,
  itemKeyOfTarget,
} from '../lib/cadence/release-types';

/**
 * FILM-719. A cadence release as it will land: each channel's posts in
 * order, the Shorts it holds because they do not fit before the next
 * episode, and an earlier episode's Shorts its long video holds back.
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
        const held = preview.held.filter(
          (post) => post.connectionId === channel.connectionId,
        );
        const displaced = preview.displaced.filter(
          (post) => post.connectionId === channel.connectionId,
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

            {held.length > 0 && (
              <div
                className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                data-test="release-calendar-held"
              >
                <p className="flex items-center gap-1 font-medium">
                  <PauseCircle className="h-3.5 w-3.5" />
                  {held.length} held
                </p>
                <ul className="mt-1 space-y-0.5">
                  {held.map((post) => (
                    <li key={post.key} data-test="release-calendar-held-post">
                      {props.labelOf(itemKeyOfTarget(post.key)).label}
                      {' — '}
                      {post.reason === 'next-episode' && post.before
                        ? `doesn't fit before the next episode's long video on ${format(new Date(post.before), 'EEE d MMM')}`
                        : 'no free slot on this channel'}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  Held Shorts are kept: re-queue or discard them under Published
                  Content.
                </p>
              </div>
            )}

            {displaced.length > 0 && (
              <div
                className="mt-2 rounded-md bg-muted p-2 text-xs"
                data-test="release-calendar-displaced"
              >
                <Badge variant="outline" className="mb-1">
                  {displaced.length} earlier Short
                  {displaced.length === 1 ? '' : 's'} held back
                </Badge>
                <ul className="space-y-0.5 text-muted-foreground">
                  {displaced.map((post) => (
                    <li key={post.publishId}>
                      {post.episodeTitle ?? 'Another episode'} — was{' '}
                      {format(new Date(post.scheduledAt), 'EEE d MMM')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
