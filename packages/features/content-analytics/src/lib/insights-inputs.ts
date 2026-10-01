import type { AudienceData, TopContent, TrendFact } from '../types';
import { compareViewsDesc } from './views';
import type { Views } from './views';

const TOP_CONTENT_LIMIT = 5;
const GEOGRAPHY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

type TrendMetric = TrendFact['metric'];

const TREND_METRICS: TrendMetric[] = ['views', 'likes', 'comments', 'shares'];

interface PlatformRow {
  platform: string;
  views: Views;
  likes: number;
  comments: number;
  /** Null where the platform reports no shares: X (FILM-1727). */
  shares: number | null;
}

interface ContentRow {
  publishId: string;
  episodeTitle: string;
  publishTitle: string;
  platform: string;
  views: Views;
  likes: number;
  engagementRate: number | null;
}

/** The window of the same length that ends the day before `range` starts. */
export function previousPeriod(range: {
  from?: Date;
  to?: Date;
}): { from: Date; to: Date } | null {
  if (!range.from || !range.to) return null;

  const length = range.to.getTime() - range.from.getTime();

  if (!(length >= 0)) return null;

  const to = new Date(range.from.getTime() - DAY_MS);

  return { from: new Date(to.getTime() - length), to };
}

function percentChange(current: number, previous: number): number {
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function fact(
  metric: TrendMetric,
  platform: string,
  current: number,
  previous: number,
): TrendFact[] {
  if (!(previous > 0)) return [];

  return [
    {
      metric,
      platform,
      current,
      previous,
      changePercent: percentChange(current, previous),
    },
  ];
}

/** The rows that measured `metric`, summed; a platform that does not is left out. */
function sum(rows: PlatformRow[], metric: TrendMetric): number {
  return rows.reduce((total, row) => total + (row[metric] ?? 0), 0);
}

/**
 * Period-over-period changes for the selected platforms and for each one.
 * A metric with no previous figure above zero has no entry.
 */
export function buildTrendFacts(
  current: PlatformRow[] | undefined,
  previous: PlatformRow[] | undefined,
): TrendFact[] {
  if (!current || !previous) return [];

  const facts: TrendFact[] = [];
  const selected = new Set(current.map((row) => row.platform));
  const previousSelected = previous.filter((row) => selected.has(row.platform));

  for (const metric of TREND_METRICS) {
    facts.push(
      ...fact(
        metric,
        'all',
        sum(current, metric),
        sum(previousSelected, metric),
      ),
    );
  }

  for (const row of current) {
    const before = previous.find((p) => p.platform === row.platform);

    if (!before) continue;

    for (const metric of TREND_METRICS) {
      const now = row[metric];
      const then = before[metric];
      // Facebook has no views and X no shares to compare (KB-153,
      // FILM-1727): no fact, never a 0.
      if (now === null || then === null) continue;
      facts.push(...fact(metric, row.platform, now, then));
    }
  }

  return facts;
}

/** The best content by views; content nobody viewed is not a top performer. */
export function topContentForInsights(
  list: ContentRow[] | undefined,
): TopContent[] | undefined {
  const top = (list ?? [])
    .filter((item) => item.views !== null && item.views > 0)
    .sort(compareViewsDesc)
    .slice(0, TOP_CONTENT_LIMIT)
    .map((item) => ({
      id: item.publishId,
      title: item.publishTitle || item.episodeTitle,
      views: item.views,
      likes: item.likes,
      engagementRate: item.engagementRate,
      platform: item.platform,
    }));

  return top.length > 0 ? top : undefined;
}

/**
 * The measured splits only: a split that was not reported is left out, never
 * sent empty or as zeros.
 */
export function audienceForInsights(
  audience: AudienceData | null | undefined,
): AudienceData | undefined {
  if (!audience) return undefined;

  const ageGroups = nonEmpty(audience.demographics?.ageGroups);
  const genders = nonEmpty(audience.demographics?.genders);
  const geography = nonEmpty(audience.geography);

  const result: AudienceData = {};

  if (ageGroups || genders) {
    result.demographics = {
      ...(ageGroups && { ageGroups }),
      ...(genders && { genders }),
    };
  }

  if (geography) {
    result.geography = Object.fromEntries(
      Object.entries(geography)
        .sort(([, a], [, b]) => b - a)
        .slice(0, GEOGRAPHY_LIMIT),
    );
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function nonEmpty(
  record: Record<string, number> | undefined,
): Record<string, number> | undefined {
  return record && Object.keys(record).length > 0 ? record : undefined;
}
