import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  isFetchDated,
} from '@kit/clickhouse';

import { platformLabel } from './platform-labels';

/**
 * How a platform's daily rows are dated, as a card reads it (FILM-1707 §2).
 *
 * The rule: a fetch-dated figure never goes on a date axis. A platform
 * whose views reach us only as lifetime totals is stored as the change
 * since the last check, dated to the day we checked. Summed over a video's
 * life that is honest; bucketed by day, week or month it moves views into
 * whichever period the fetch happened to land in.
 *
 * `isFetchDated` (in @kit/clickhouse, beside the matrix) is the one place
 * that decides it; the Deep Dive queries apply the same function.
 */
export { isFetchDated };

/** Platforms whose rows are dated to the day they describe. */
export const TRUE_DAILY_PLATFORMS: readonly AnalyticsPlatform[] =
  ANALYTICS_PLATFORMS.filter((platform) => !isFetchDated(platform));

function isAnalyticsPlatform(platform: string): platform is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(platform);
}

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The sentence a date-axis card carries when it leaves platforms out. */
export function fetchDatedSentence(
  excluded: readonly AnalyticsPlatform[],
): string {
  const names = listOf(excluded.map(platformLabel));
  const verb = excluded.length === 1 ? 'reports' : 'report';
  const pronoun = excluded.length === 1 ? 'it' : 'they';

  return `${names} ${excluded.length === 1 ? 'isn’t' : 'aren’t'} shown here — ${pronoun} ${verb} running totals, not daily views.`;
}

/**
 * What a card on a date axis covers.
 *
 * - `platforms`: the ones it may plot — the candidates, minus fetch-dated.
 * - `excluded`: fetch-dated candidates the project actually publishes to.
 *   Empty for a creator who uses none of them, so nobody reads a caveat
 *   about platforms they do not use.
 * - `sentence`: what the card says about the exclusion, or null.
 */
export interface DateAxisScope {
  platforms: AnalyticsPlatform[];
  excluded: AnalyticsPlatform[];
  sentence: string | null;
}

export function dateAxisScope(
  candidates: readonly AnalyticsPlatform[],
  publishedTo: readonly string[],
): DateAxisScope {
  const present = new Set(publishedTo.filter(isAnalyticsPlatform));
  const excluded = candidates.filter(
    (platform) => isFetchDated(platform) && present.has(platform),
  );

  return {
    platforms: candidates.filter((platform) => !isFetchDated(platform)),
    excluded,
    sentence: excluded.length > 0 ? fetchDatedSentence(excluded) : null,
  };
}
