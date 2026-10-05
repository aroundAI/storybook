import {
  type AnalyticsPlatform,
  type MetricFamily,
  capabilityFor,
} from '@kit/clickhouse';

import { formatNumber } from '../../lib/format';
import type { Measured } from '../../lib/measured';
import { platformLabel } from '../../lib/platform-labels';
import { SHOWN_ANALYTICS_PLATFORMS } from '../../lib/shown-platforms';

export { platformLabel };

/**
 * What a card shows, for the provenance it declares (FILM-1706).
 *
 * A `MetricFamily` for anything a platform reports, several when a card
 * spans them. `recorded` for figures a person or an import wrote down
 * (the revenue records), which the capability matrix — a description of
 * platform APIs — has no row for. `generated` for a language model's
 * reading, which is not a measurement at all. `summary` for a sentence
 * this page puts together from its own figures by a fixed rule — neither a
 * measurement nor a model's reading (FILM-1707). `not_collected` for a
 * slot that says what we do not collect, and shows no figure.
 */
export type CardMetricFamily =
  | MetricFamily
  | readonly [MetricFamily, ...MetricFamily[]]
  | NotFromAPlatform;

/** The kinds of card whose figure no platform reported. */
export type NotFromAPlatform =
  | 'recorded'
  | 'generated'
  | 'summary'
  | 'not_collected';

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

export const RECORDED_SOURCE =
  'Revenue recorded against this project’s videos — entered by you, or imported from a connected platform.';

export const GENERATED_SOURCE =
  'Written by a language model from the figures on this page. It is a reading of them, not a measurement.';

export const SUMMARY_SOURCE =
  'Put together on this page from the figures above by a fixed rule. Nothing new is measured, and no language model wrote it.';

export const NOT_COLLECTED_SOURCE =
  'Nothing we collect from a connected channel answers this, so there is no figure to show.';

const NOT_FROM_A_PLATFORM_SOURCE = {
  recorded: RECORDED_SOURCE,
  generated: GENERATED_SOURCE,
  summary: SUMMARY_SOURCE,
  not_collected: NOT_COLLECTED_SOURCE,
} as const satisfies Record<NotFromAPlatform, string>;

export function isNotFromAPlatform(
  metricFamily: CardMetricFamily,
): metricFamily is NotFromAPlatform {
  return (
    typeof metricFamily === 'string' &&
    Object.hasOwn(NOT_FROM_A_PLATFORM_SOURCE, metricFamily)
  );
}

/** What a card no platform reported says about where its content comes from. */
export function notFromAPlatformSource(kind: NotFromAPlatform): string {
  return NOT_FROM_A_PLATFORM_SOURCE[kind];
}

/**
 * Where a card's figure comes from, in the capability matrix's own
 * creator-facing sentences: one per platform that has the data at all.
 * Platforms without it are FILM-1705's coverage copy, not this.
 */
export function sourceNotesFor(
  metricFamily: CardMetricFamily,
  platforms: readonly AnalyticsPlatform[] = SHOWN_ANALYTICS_PLATFORMS,
): string[] {
  if (isNotFromAPlatform(metricFamily)) {
    return [notFromAPlatformSource(metricFamily)];
  }

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
 * A total. Absent means it could not be read (KB-16); a measured `null`
 * means nothing in the selection measured it (KB-192). Neither is zero,
 * and they are not each other: the card says which, never drawing a 0.
 */
export function countClaim(
  value: Measured<number | null>,
  sentence: string,
): CardClaim {
  if (value.kind === 'absent') {
    return {
      figure: null,
      noFigure: 'Could not be read.',
      sentence: 'This figure could not be loaded.',
    };
  }

  if (value.value === null) {
    return {
      figure: null,
      noFigure: 'Not measured.',
      sentence: 'Nothing in the selected period measured this figure.',
    };
  }

  return { figure: value.value.toLocaleString('en-US'), sentence };
}

/**
 * The platforms among `rows` that have any views, as matrix platforms — so
 * a card says where its figure comes from only for platforms it covers.
 */
/** The rows with a views figure: not measured is not a rank or a share (KB-153). */
function withViews<T extends { views: number | null }>(
  rows: readonly T[],
): (T & { views: number })[] {
  return rows.filter((row): row is T & { views: number } => row.views !== null);
}

export function platformsWithViews(
  rows: readonly { platform: string; views: number | null }[] | undefined,
): AnalyticsPlatform[] {
  const known: readonly string[] = SHOWN_ANALYTICS_PLATFORMS;

  return SHOWN_ANALYTICS_PLATFORMS.filter((platform) =>
    (rows ?? []).some(
      (row) =>
        row.views !== null &&
        row.views > 0 &&
        row.platform.toLowerCase() === platform &&
        known.includes(platform),
    ),
  );
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The largest entries by value — more than one when they tie. */
function leaders<T>(items: readonly T[], value: (item: T) => number): T[] {
  const top = Math.max(...items.map(value));

  return items.filter((item) => value(item) === top);
}

export function platformSplitClaim(
  rows: readonly { platform: string; views: number | null }[],
): CardClaim {
  // A platform with no single view (Facebook) has no share of the views.
  const platforms = withViews(rows);
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
  rows: readonly { title: string; views: number | null }[],
): CardClaim {
  // An item whose views are not measured (Facebook) is not ranked by them.
  const items = withViews(rows);

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
