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
  /** Each channel's newest measurement, in the window or not. */
  lastDataById: Record<string, string | null> = {},
): string {
  const label = platformLabel(total.platform);

  const parts = [
    total.startsOn
      ? `${label} total begins ${formatSubscriberDay(total.startsOn)}, the first day every active ${label} channel has a level.`
      : total.excluded.length > 0
        ? describeExcluded(label, total.excluded, channelNames, lastDataById)
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
  lastDataById: Record<string, string | null>,
): string {
  const nameOf = (id: string) => channelNames[id] ?? 'a channel';

  const ended = excluded.filter((id) => lastDataById[id]);
  const never = excluded.filter((id) => !lastDataById[id]);

  const reasons = [
    ...ended.map(
      (id) =>
        `${nameOf(id)} has no data since ${formatSubscriberDay(
          lastDataById[id]!,
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
