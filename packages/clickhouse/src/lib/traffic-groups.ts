/**
 * Traffic-source grouping (FILM-1605).
 *
 * Pure, so the taxonomy and the share arithmetic can be tested directly —
 * and so a mapping change is a code change rather than a migration. The
 * SQL groups by the raw `source` name; nothing below this module reaches
 * the database.
 */

/** Presentation groups, in the order a stacked chart should render them. */
export const TRAFFIC_SOURCE_GROUPS = [
  'browse_suggested',
  'search',
  'shorts_feed',
  'external',
  'playlists',
  'channel_page',
  'direct',
  'other',
] as const;

export type TrafficSourceGroup = (typeof TRAFFIC_SOURCE_GROUPS)[number];

/**
 * Bucket granularities the traffic breakdown supports.
 *
 * Here rather than beside the SQL that consumes it, for the same reason
 * MIN_MATURE_VIDEOS lives in lib/cohort-growth.ts: this module is pure and
 * dependency-free, so a zod schema or a browser bundle can share the
 * granularity list instead of restating it and drifting. The
 * ClickHouse-function lookup this drives stays in queries-advanced.ts,
 * which is where the driver already is.
 */
export const TRAFFIC_SOURCE_BUCKETS = ['day', 'week', 'month'] as const;

export type TrafficBucket = (typeof TRAFFIC_SOURCE_BUCKETS)[number];

/**
 * Raw Reporting-API source names to groups.
 *
 * Three assignments are deliberate rather than obvious, and are recorded
 * here so a reader disagrees with the decision instead of the accident:
 *
 * - `END_SCREEN` and `ANNOTATION` are *not* browse_suggested. They are
 *   surfaces on the channel's own videos, not YouTube's recommender, and
 *   folding them in would inflate the very metric the 60% milestone is
 *   read against — invisibly, because both are usually small.
 * - `HASHTAG_PAGE` is not `search`. It is browse-shaped but is not the
 *   recommender either, so it goes to `other` rather than strengthening
 *   either claim on thin evidence.
 * - `ADVERTISING` is `other`, not excluded. Paid views are real views and
 *   belong in the denominator; dropping them would make organic share
 *   read high.
 */
const SOURCE_TO_GROUP: Record<string, TrafficSourceGroup> = {
  RELATED_VIDEO: 'browse_suggested',
  SUBSCRIBER: 'browse_suggested',
  NOTIFICATION: 'browse_suggested',
  YT_SEARCH: 'search',
  SHORTS: 'shorts_feed',
  SOUND_PAGE: 'shorts_feed',
  VIDEO_REMIXES: 'shorts_feed',
  EXTERNAL_URL: 'external',
  PLAYLIST: 'playlists',
  PLAYLIST_PAGE: 'playlists',
  CHANNEL_PAGE: 'channel_page',
  DIRECT_OR_UNKNOWN: 'direct',
  ADVERTISING: 'other',
  ANNOTATION: 'other',
  END_SCREEN: 'other',
  PRODUCT_PAGE: 'other',
  HASHTAG_PAGE: 'other',
  LIVE_REDIRECT: 'other',
};

/**
 * The group a raw source belongs to.
 *
 * Unrecognised names fall to `other` rather than being dropped. The parser
 * stores `TS_<code>` for any code it does not know (csv-parsers.ts), so
 * unknown sources genuinely reach this function — and a `switch` with no
 * default would remove them from the numerator while leaving them in the
 * denominator, so the groups would silently stop summing to the total.
 */
export function groupForSource(source: string): TrafficSourceGroup {
  // Object.hasOwn, not a bare index. `SOURCE_TO_GROUP['constructor']`
  // resolves up the prototype chain to a truthy function, so `??` never
  // fires and the row is accumulated under a key that is not in
  // TRAFFIC_SOURCE_GROUPS — its views then vanish from every group *and*
  // from the bucket total, which is precisely what the fallback exists to
  // prevent.
  return Object.hasOwn(SOURCE_TO_GROUP, source)
    ? SOURCE_TO_GROUP[source]!
    : 'other';
}

/**
 * Every raw source assigned to a group.
 *
 * `SOURCE_TO_GROUP` above is the only definition of which sources count as
 * Browse+Suggested — every consumer reaches it through `groupForSource`.
 * This enumerates a group's members for callers that need the set rather
 * than a lookup, which is what lets the browse+suggested membership be
 * asserted directly instead of restated in a second hand-kept list.
 *
 * Review once argued to drop it as a dead export, and once to keep it;
 * FILM-1708 settled that on the evidence: `windowTrafficMix` below uses it
 * to tell a member of the taxonomy from a code the parser stored as
 * `TS_<code>`, which is what the drill-down shows as unrecognised.
 */
export function sourcesInGroup(group: TrafficSourceGroup): string[] {
  return Object.entries(SOURCE_TO_GROUP)
    .filter(([, assigned]) => assigned === group)
    .map(([source]) => source);
}

/** One `(bucket, source)` row as the query returns it. */
export interface TrafficSourceRow {
  bucket: string;
  source: string;
  views: number;
  watchTimeMinutes: number;
}

/** One native source code inside a group, as observed in a bucket. */
export interface TrafficSourceShare {
  source: string;
  views: number;
  watchTimeMinutes: number;
  /** Share of the bucket's total views, so a group's sources sum to it. */
  share: number;
}

export interface TrafficGroupShare {
  group: TrafficSourceGroup;
  views: number;
  watchTimeMinutes: number;
  /** Share of the bucket's total views, 0 when the bucket has none. */
  share: number;
  /**
   * The native codes that made up this group in this bucket — only those
   * observed, largest first. Carried in the breakdown response rather than
   * fetched again (FILM-1708): one scan, one denominator, so the parts
   * cannot disagree with the whole.
   */
  sources: TrafficSourceShare[];
}

export interface TrafficGroupBucket {
  bucket: string;
  totalViews: number;
  totalWatchTimeMinutes: number;
  groups: TrafficGroupShare[];
}

/**
 * Folds raw per-source rows into per-bucket group totals and shares.
 *
 * Every group is present in every bucket, as zero where it has no views. A
 * group missing from a bucket is indistinguishable from a group with no
 * views, and a stacked chart whose series appear and disappear re-orders
 * its colours between renders.
 *
 * Shares are computed against the bucket total accumulated here, not a
 * separately-queried count: one query, one denominator, so the parts
 * cannot disagree with the whole.
 */
export function groupTrafficRows(
  rows: TrafficSourceRow[],
): TrafficGroupBucket[] {
  const buckets = new Map<
    string,
    {
      views: Map<TrafficSourceGroup, number>;
      minutes: Map<TrafficSourceGroup, number>;
      sources: Map<TrafficSourceGroup, Map<string, SourceTotals>>;
    }
  >();

  for (const row of rows) {
    let bucket = buckets.get(row.bucket);

    if (!bucket) {
      bucket = { views: new Map(), minutes: new Map(), sources: new Map() };
      buckets.set(row.bucket, bucket);
    }

    const group = groupForSource(row.source);

    bucket.views.set(group, (bucket.views.get(group) ?? 0) + row.views);
    bucket.minutes.set(
      group,
      (bucket.minutes.get(group) ?? 0) + row.watchTimeMinutes,
    );
    addSource(bucket.sources, group, row.source, row);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, totals]) => {
      let totalViews = 0;
      let totalWatchTimeMinutes = 0;

      for (const group of TRAFFIC_SOURCE_GROUPS) {
        totalViews += totals.views.get(group) ?? 0;
        totalWatchTimeMinutes += totals.minutes.get(group) ?? 0;
      }

      return {
        bucket,
        totalViews,
        totalWatchTimeMinutes,
        groups: TRAFFIC_SOURCE_GROUPS.map((group) => {
          const views = totals.views.get(group) ?? 0;

          return {
            group,
            views,
            watchTimeMinutes: totals.minutes.get(group) ?? 0,
            share: totalViews > 0 ? views / totalViews : 0,
            sources: sourceShares(totals.sources.get(group), totalViews),
          };
        }),
      };
    });
}

interface SourceTotals {
  views: number;
  watchTimeMinutes: number;
}

function addSource(
  into: Map<TrafficSourceGroup, Map<string, SourceTotals>>,
  group: TrafficSourceGroup,
  source: string,
  { views, watchTimeMinutes }: SourceTotals,
) {
  let sources = into.get(group);

  if (!sources) {
    sources = new Map();
    into.set(group, sources);
  }

  const totals = sources.get(source) ?? { views: 0, watchTimeMinutes: 0 };

  sources.set(source, {
    views: totals.views + views,
    watchTimeMinutes: totals.watchTimeMinutes + watchTimeMinutes,
  });
}

/** Largest first, then by code, so the order is stable between renders. */
function sourceShares(
  sources: Map<string, SourceTotals> | undefined,
  totalViews: number,
): TrafficSourceShare[] {
  return [...(sources ?? [])]
    .map(([source, totals]) => ({
      source,
      ...totals,
      share: totalViews > 0 ? totals.views / totalViews : 0,
    }))
    .sort(
      (a, b) =>
        b.views - a.views ||
        (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
    );
}

/** One native code over the whole window, and whether the taxonomy knows it. */
export interface WindowSourceShare {
  source: string;
  views: number;
  /** Share of all views in the window. */
  share: number;
  /**
   * False for a code `SOURCE_TO_GROUP` does not list — the parser's
   * `TS_<code>` fallback — which `groupForSource` sends to `other`. Shown,
   * never hidden: hiding it makes `other` unexplainable.
   */
  recognised: boolean;
}

export interface WindowGroupShare {
  group: TrafficSourceGroup;
  views: number;
  /** Share of all views in the window. */
  share: number;
  /** Only the codes observed in the window, largest first. */
  sources: WindowSourceShare[];
}

/**
 * Each group's views and share over a whole window, with the native codes
 * that made it up (FILM-1708).
 *
 * The list is what occurred, not the taxonomy: showing all three members of
 * browse_suggested when two occurred invites the reader to conclude the
 * third was zero. Every share is over the same window total, so a group's
 * sources sum to the group exactly — the views are integers, summed once.
 */
export function windowTrafficMix(buckets: readonly TrafficGroupBucket[]): {
  windowViews: number;
  groups: WindowGroupShare[];
} {
  const windowViews = buckets.reduce((sum, b) => sum + b.totalViews, 0);
  const views = new Map<TrafficSourceGroup, number>();
  const sources = new Map<TrafficSourceGroup, Map<string, SourceTotals>>();

  for (const bucket of buckets) {
    for (const group of bucket.groups) {
      views.set(group.group, (views.get(group.group) ?? 0) + group.views);

      for (const source of group.sources) {
        addSource(sources, group.group, source.source, source);
      }
    }
  }

  const share = (n: number) => (windowViews > 0 ? n / windowViews : 0);

  return {
    windowViews,
    groups: TRAFFIC_SOURCE_GROUPS.map((group) => {
      const members = new Set(sourcesInGroup(group));

      return {
        group,
        views: views.get(group) ?? 0,
        share: share(views.get(group) ?? 0),
        sources: sourceShares(sources.get(group), windowViews).map(
          (source) => ({
            source: source.source,
            views: source.views,
            share: source.share,
            recognised: members.has(source.source),
          }),
        ),
      };
    }),
  };
}
