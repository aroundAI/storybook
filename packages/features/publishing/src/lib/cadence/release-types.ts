/**
 * FILM-719. What a cadence release looks like on its channels' calendars,
 * as the schedule action returns it and the Publish screen shows it.
 */
import type { CadenceContentType } from './cadence';
import type { HeldReason } from './plan-release';

export interface PlannedPost {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
  scheduledAt: string;
}

export interface HeldPost {
  key: string;
  connectionId: string;
  reason: HeldReason;
  /** The next episode's long video it would have gone after */
  before: string | null;
}

/** An earlier episode's Short this release's long video holds back */
export interface DisplacedPost {
  publishId: string;
  connectionId: string;
  episodeId: string;
  episodeTitle: string | null;
  scheduledAt: string;
}

export interface ChannelQueue {
  connectionId: string;
  name: string;
  platform: string;
  queueEndsAt: string | null;
}

export interface ReleasePreview {
  placed: PlannedPost[];
  held: HeldPost[];
  displaced: DisplacedPost[];
  channels: ChannelQueue[];
}

/** A release target's key: its schedule item, then its channel */
export function releaseTargetKey(itemKey: string, connectionId: string) {
  return `${itemKey}::${connectionId}`;
}

export function itemKeyOfTarget(key: string) {
  return key.split('::')[0] ?? key;
}
