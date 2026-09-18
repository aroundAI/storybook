import { formatSubscriberDay } from './subscriber-disclosure';
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
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function describeTotal(
  total: PlatformSubscriberSum,
  channelNames: Record<string, string>,
): string {
  const label = platformLabel(total.platform);

  const parts = [
    total.startsOn
      ? `${label} total begins ${formatSubscriberDay(total.startsOn)}, the first day every active ${label} channel has a level.`
      : total.excluded.length > 0
        ? `No ${label} total yet: ${listNames(
            total.excluded.map((id) => channelNames[id] ?? 'a channel'),
          )} ${total.excluded.length === 1 ? 'has' : 'have'} no subscriber count.`
        : total.channelCount > 0
          ? // Every channel has data, just never on the same day — capture
            // for one ended before another's began.
            `No ${label} total: ${listNames(
              total.included.map((id) => channelNames[id] ?? 'a channel'),
            )} have no day in common — one may have stopped being captured.`
          : `No ${label} total: no active ${label} channel publishes here.`,
  ];

  if (total.disconnected.length > 0) {
    parts.push(
      `Leaves out ${listNames(total.disconnected)}, disconnected and no longer measured.`,
    );
  }

  if (total.channelCount > 1) {
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
