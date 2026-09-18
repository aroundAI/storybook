import { isSubscriberTracked } from '@kit/clickhouse';

import {
  NO_SUBSCRIBER_LEVEL,
  formatSubscriberDay,
} from './subscriber-disclosure';
import type { PlatformSubscriberSum } from './subscriber-series-sum';

/**
 * The sentence under each platform's total in the Deep Dive subscriber card
 * (FILM-1617 §2.1): where the total starts, or why there is none, and what it
 * leaves out.
 */

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X',
  linkedin: 'LinkedIn',
};

/** Said of every channel on a platform no snapshot is ever taken for. */
export const UNTRACKED_PLATFORMS_SENTENCE =
  'Subscriber counts aren’t tracked for Facebook, X or LinkedIn channels.';

/** The same sentence, leading into a list of the channels it applies to. */
export function describeUntrackedChannels(names: string[]): string {
  return `${UNTRACKED_PLATFORMS_SENTENCE.slice(0, -1)}: ${names.join(', ')}.`;
}

/**
 * Why a channel has — or has no — line. One answer, used by the empty state,
 * the list of channels without a line and the total's note, so the three
 * cannot give different reasons for the same channel.
 */
export type ChannelStatus =
  | { kind: 'untracked' }
  | { kind: 'ended'; since: string }
  | { kind: 'none' }
  | { kind: 'ok' };

export function channelStatus(
  series: { points: unknown[]; lastDataDate: string | null },
  /** Undefined when the channel list does not name it: platform unknown. */
  channel: { platform: string } | undefined,
): ChannelStatus {
  // Only a known platform can be called untracked; an unknown one is
  // explained from its data, never with a claim about its platform.
  if (channel && !isSubscriberTracked(channel.platform)) {
    return { kind: 'untracked' };
  }

  if (series.points.length > 0) return { kind: 'ok' };

  // Measured, then stopped before this window: not "no count yet".
  if (series.lastDataDate) return { kind: 'ended', since: series.lastDataDate };

  return { kind: 'none' };
}

/** The sentence for a channel with no line; null for one that has a line. */
export function describeChannelStatus(status: ChannelStatus): string | null {
  switch (status.kind) {
    case 'untracked':
      return UNTRACKED_PLATFORMS_SENTENCE;
    case 'ended':
      return `No data since ${formatSubscriberDay(status.since)} — its capture may have stopped.`;
    case 'none':
      return NO_SUBSCRIBER_LEVEL;
    case 'ok':
      return null;
  }
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function describeTotal(
  total: PlatformSubscriberSum,
  channelNames: Record<string, string>,
  /** Each channel's status, from `channelStatus` — the one rule. */
  statusById: Record<string, ChannelStatus> = {},
): string {
  const label = platformLabel(total.platform);

  const parts = [
    total.startsOn
      ? `${label} total begins ${formatSubscriberDay(total.startsOn)}, the first day every active ${label} channel has a level.`
      : total.excluded.length > 0
        ? describeExcluded(label, total.excluded, channelNames, statusById)
        : total.channelCount > 0
          ? // Every channel has data, just never on the same day — capture
            // for one ended before another's began.
            `No ${label} total: ${listNames(
              total.included.map((id) => channelNames[id] ?? 'a channel'),
            )} have no day in common — one may have stopped being captured.`
          : `No ${label} total: no active ${label} channel publishes here.`,
  ];

  // A total spans only days every channel has, so it ends with the channel
  // whose data ends first — say which, or the line just stops.
  if (total.endsOn && total.limitedBy.length > 0) {
    parts.push(
      `It ends ${formatSubscriberDay(total.endsOn)}, the last day ${listNames(
        total.limitedBy.map((id) => channelNames[id] ?? 'a channel'),
      )} ${total.limitedBy.length === 1 ? 'has' : 'have'} data.`,
    );
  }

  if (total.disconnected.length > 0) {
    parts.push(
      `Leaves out ${listNames(total.disconnected)}, disconnected and no longer measured.`,
    );
  }

  // Only of a total that is drawn: with none, there is nothing to overcount.
  if (total.startsOn && total.channelCount > 1) {
    parts.push(
      'Someone subscribed to more than one of these channels is counted once for each.',
    );
  }

  return parts.join(' ');
}

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Why each empty channel leaves no total. A channel never measured has no
 * count yet; one whose data ended before the window had a count and
 * stopped — its capture may have broken — and saying "no count yet" of it
 * sends the reader looking for the wrong problem.
 */
function describeExcluded(
  label: string,
  excluded: string[],
  channelNames: Record<string, string>,
  statusById: Record<string, ChannelStatus>,
): string {
  const nameOf = (id: string) => channelNames[id] ?? 'a channel';
  const endedSince = (id: string) => {
    const status = statusById[id];
    return status?.kind === 'ended' ? status.since : null;
  };

  // The channel list's rule, not a second copy of it: ended iff
  // `channelStatus` says so.
  const ended = excluded.filter((id) => endedSince(id) !== null);
  const never = excluded.filter((id) => endedSince(id) === null);

  const reasons = [
    ...ended.map(
      (id) =>
        `${nameOf(id)} has no data since ${formatSubscriberDay(
          endedSince(id)!,
        )} — its capture may have stopped`,
    ),
    ...(never.length > 0
      ? [
          `${listNames(never.map(nameOf))} ${
            never.length === 1 ? 'has' : 'have'
          } no subscriber count`,
        ]
      : []),
  ];

  return `No ${label} total yet: ${reasons.join('; ')}.`;
}
