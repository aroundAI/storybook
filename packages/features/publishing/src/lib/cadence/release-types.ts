/**
 * FILM-719, FILM-2209. What a cadence release looks like on its channels'
 * calendars, as the schedule action returns it and the Publish screen shows
 * it.
 */
import type { CadenceContentType } from './cadence';

export interface PlannedPost {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
  scheduledAt: string;
}

export interface ChannelQueue {
  connectionId: string;
  name: string;
  platform: string;
  queueEndsAt: string | null;
}

/**
 * FILM-2209. A channel's Shorts queue after the release: how many Shorts
 * wait, when the last goes, and how far that is past the channel's last long
 * video. A queue that keeps growing means more Shorts per episode than the
 * slots between long videos.
 */
export interface ShortsQueueSummary {
  connectionId: string;
  name: string;
  platform: string;
  queued: number;
  lastShortAt: string | null;
  longVideosEndAt: string | null;
  daysAhead: number | null;
  /** More than QUEUE_WARNING_DAYS ahead of the long videos */
  runsAhead: boolean;
}

/** Past this many days ahead of the long videos, the queue is called out */
export const QUEUE_WARNING_DAYS = 7;

export interface ReleasePreview {
  placed: PlannedPost[];
  channels: ChannelQueue[];
  shortsQueue: ShortsQueueSummary[];
}

/** A release target's key: its schedule item, then its channel */
export function releaseTargetKey(itemKey: string, connectionId: string) {
  return `${itemKey}::${connectionId}`;
}

export function itemKeyOfTarget(key: string) {
  return key.split('::')[0] ?? key;
}
