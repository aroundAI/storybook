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

export interface TrafficGroupShare {
  group: TrafficSourceGroup;
  views: number;
  watchTimeMinutes: number;
  /** Share of the bucket's total views, 0 when the bucket has none. */
  share: number;
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
    }
  >();

  for (const row of rows) {
    let bucket = buckets.get(row.bucket);

    if (!bucket) {
      bucket = { views: new Map(), minutes: new Map() };
      buckets.set(row.bucket, bucket);
    }

    const group = groupForSource(row.source);

    bucket.views.set(group, (bucket.views.get(group) ?? 0) + row.views);
    bucket.minutes.set(
      group,
      (bucket.minutes.get(group) ?? 0) + row.watchTimeMinutes,
    );
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
          };
        }),
      };
    });
}
