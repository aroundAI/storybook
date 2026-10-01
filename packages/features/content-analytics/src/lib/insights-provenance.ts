import type { AggregateAnalytics } from '../types';
import { platformLabel } from './platform-labels';

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');

  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function timeInWords(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

/**
 * What a generated reading was given, and when (FILM-1707 §3).
 *
 * A language model's text is not a measurement, so its provenance is not
 * which platform reported a number: it is which of this page's numbers the
 * model was handed, for which window, and when the reading arrived. Built
 * from the payload the page actually sends — what is absent from it is not
 * named, so the sentence cannot claim an input the model never saw.
 */
export function insightsProvenance(
  analytics: AggregateAnalytics | null,
  windowLabel: string,
  receivedAt: number | null,
): string {
  const when = receivedAt
    ? `received ${timeInWords(receivedAt)}`
    : 'not yet received';

  if (!analytics) {
    return `Written by a language model with no figures from this page for ${windowLabel}; ${when}.`;
  }

  const platforms = (analytics.platformMetrics ?? []).map(({ platform }) =>
    platformLabel(platform),
  );
  const top = analytics.topContent?.length ?? 0;
  const audience = analytics.audience;
  const hasAudience = Boolean(
    audience &&
      (Object.keys(audience.demographics?.ageGroups ?? {}).length > 0 ||
        Object.keys(audience.demographics?.genders ?? {}).length > 0 ||
        Object.keys(audience.geography ?? {}).length > 0),
  );

  const inputs = [
    'this project’s totals',
    ...(platforms.length > 0
      ? [`per-platform totals for ${listOf(platforms)}`]
      : []),
    ...(top > 0 ? [`the top ${top} ${top === 1 ? 'video' : 'videos'}`] : []),
    ...(hasAudience ? ['the audience breakdown'] : []),
    ...((analytics.trendFacts?.length ?? 0) > 0
      ? ['changes against the period before']
      : []),
  ];

  return `Written by a language model, given ${listOf(inputs)} for ${windowLabel}; ${when}.`;
}
