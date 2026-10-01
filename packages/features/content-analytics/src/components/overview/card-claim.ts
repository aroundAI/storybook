import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  type MetricFamily,
  capabilityFor,
} from '@kit/clickhouse';

import { formatNumber } from '../../lib/format';

/**
 * What a card shows, for the provenance it declares (FILM-1706).
 *
 * A `MetricFamily` for anything a platform reports, several when a card
 * spans them. `recorded` for figures a person or an import wrote down
 * (the revenue records), which the capability matrix — a description of
 * platform APIs — has no row for. `generated` for a language model's
 * reading, which is not a measurement at all.
 */
export type CardMetricFamily =
  | MetricFamily
  | readonly [MetricFamily, ...MetricFamily[]]
  | 'recorded'
  | 'generated';

/**
 * The one claim a card leads with: a figure and the sentence that says
 * what it is — or, where no single honest figure exists, the reason, which
 * the card shows. Never a zero standing in for "not measured".
 */
export type CardClaim =
  | { figure: string; sentence: string; noFigure?: undefined }
  | { figure: null; noFigure: string; sentence: string };

/**
 * Words that assert a cause. A card measures; it cannot say why a number
 * moved without an experiment (FILM-1724), so its sentence never does.
 */
export const CAUSAL_VOCABULARY =
  /\b(?:because|due to|driven by|drives?|driving|caused?|causes|causing|thanks to|as a result|leads? to|results? in)\b/i;

const RECORDED_SOURCE =
  'Revenue recorded against this project’s videos — entered by you, or imported from a connected platform.';

const GENERATED_SOURCE =
  'Written by a language model from the figures on this page. It is a reading of them, not a measurement.';

/**
 * Where a card's figure comes from, in the capability matrix's own
 * creator-facing sentences: one per platform that has the data at all.
 * Platforms without it are FILM-1705's coverage copy, not this.
 */
export function sourceNotesFor(
  metricFamily: CardMetricFamily,
  platforms: readonly AnalyticsPlatform[] = ANALYTICS_PLATFORMS,
): string[] {
  if (metricFamily === 'recorded') return [RECORDED_SOURCE];
  if (metricFamily === 'generated') return [GENERATED_SOURCE];

  const families: readonly MetricFamily[] =
    typeof metricFamily === 'string' ? [metricFamily] : metricFamily;

  const notes = families.flatMap((family) =>
    platforms
      .map((platform) => capabilityFor(family, platform))
      .filter(({ level }) => level === 'native' || level === 'derived')
      .map(({ note }) => note),
  );

  return [...new Set(notes)];
}

/** A query's state, as the card needs it. */
export interface QueryLike<T> {
  isLoading: boolean;
  isError: boolean;
  data: T | undefined;
}

/**
 * The claim for a card fed by one query: nothing while it loads, the
 * failure in words when it fails, and the card's own claim otherwise.
 */
export function claimFromQuery<T>(
  query: QueryLike<T>,
  build: (data: T) => CardClaim,
  failure = 'A fetch failure, not an absence of data — retry, or check the project scope.',
): CardClaim | 'loading' {
  if (query.isLoading) return 'loading';

  if (query.data === undefined) {
    return {
      figure: null,
      noFigure: query.isError ? 'Could not be read.' : 'No data.',
      sentence: failure,
    };
  }

  return build(query.data);
}

/**
 * A total. `null` means it could not be read, which is not zero: the card
 * says so instead of drawing a 0 (KB-16).
 */
export function countClaim(value: number | null, sentence: string): CardClaim {
  return value === null
    ? {
        figure: null,
        noFigure: 'Could not be read.',
        sentence: 'This figure could not be loaded.',
      }
    : { figure: value.toLocaleString('en-US'), sentence };
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

/**
 * The platforms among `rows` that have any views, as matrix platforms — so
 * a card says where its figure comes from only for platforms it covers.
 */
export function platformsWithViews(
  rows: readonly { platform: string; views: number }[] | undefined,
): AnalyticsPlatform[] {
  const known: readonly string[] = ANALYTICS_PLATFORMS;

  return ANALYTICS_PLATFORMS.filter((platform) =>
    (rows ?? []).some(
      (row) =>
        row.views > 0 &&
        row.platform.toLowerCase() === platform &&
        known.includes(platform),
    ),
  );
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The largest entries by value — more than one when they tie. */
function leaders<T>(items: readonly T[], value: (item: T) => number): T[] {
  const top = Math.max(...items.map(value));

  return items.filter((item) => value(item) === top);
}

export function platformSplitClaim(
  platforms: readonly { platform: string; views: number }[],
): CardClaim {
  const total = platforms.reduce((sum, { views }) => sum + views, 0);

  if (total === 0) {
    return {
      figure: null,
      noFigure: 'No views recorded in this period.',
      sentence: 'There is no split between platforms to show.',
    };
  }

  const top = leaders(platforms, ({ views }) => views);
  const share = percent(top[0]!.views / total);

  return top.length > 1
    ? {
        figure: share,
        sentence: `${top.map(({ platform }) => platformLabel(platform)).join(' and ')} had equal shares of ${formatNumber(total)} views.`,
      }
    : {
        figure: share,
        sentence: `${platformLabel(top[0]!.platform)} had the largest share of ${formatNumber(total)} views.`,
      };
}

export function genderClaim(genders: {
  male: number;
  female: number;
  other?: number;
}): CardClaim {
  const groups = [
    { label: 'Men', share: genders.male },
    { label: 'Women', share: genders.female },
    ...(genders.other ? [{ label: 'Other', share: genders.other }] : []),
  ];
  const top = leaders(groups, ({ share }) => share);
  const figure = `${Math.round(top[0]!.share)}%`;

  return top.length > 1
    ? {
        figure,
        sentence: `No group was larger than the others: ${top.map(({ label }) => label.toLowerCase()).join(' and ')} were even.`,
      }
    : {
        figure,
        sentence: `${top[0]!.label} made up the largest share of viewers.`,
      };
}

export function topRegionClaim(
  regions: readonly { country: string; percentage: number }[],
): CardClaim {
  if (regions.length === 0) {
    return {
      figure: null,
      noFigure: 'No geographic data yet.',
      sentence: 'No platform has reported where viewers are.',
    };
  }

  const top = leaders(regions, ({ percentage }) => percentage);
  const figure = `${Math.round(top[0]!.percentage)}%`;

  return top.length > 1
    ? {
        figure,
        sentence: `${top.map(({ country }) => country).join(' and ')} had equal shares of viewers.`,
      }
    : {
        figure,
        sentence: `${top[0]!.country} had the largest share of viewers.`,
      };
}

export function topContentClaim(
  items: readonly { title: string; views: number }[],
): CardClaim {
  if (items.length === 0) {
    return {
      figure: null,
      noFigure: 'Nothing to rank yet.',
      sentence: 'No published item has views in this period.',
    };
  }

  const top = leaders(items, ({ views }) => views);
  const figure = top[0]!.views.toLocaleString('en-US');

  return top.length > 1
    ? {
        figure,
        sentence: `${top.length} items are level on views, so there is no single top item.`,
      }
    : { figure, sentence: `“${top[0]!.title}” had the most views.` };
}
