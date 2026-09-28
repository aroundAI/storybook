import { getClickHouseClient, isClickHouseEnabled } from './client';

/**
 * The only readers of unique-account figures (cross-platform reach design,
 * approved 2026-09-28).
 *
 * A unique count does not add up: not across days (one person seen twice),
 * posts (one person who saw two), channels or platforms (nobody can match
 * the same person across them). So every function here takes exactly one
 * channel or one post, and none sums a reach figure over anything but a
 * single post's own days. `__tests__/reach-one-reader.test.ts` fails on a
 * query anywhere else that sums `accounts_reached` or reads
 * `channel_windows`' reach.
 */

export type ReachPlatform = 'instagram' | 'facebook';

export interface ChannelReachDay {
  /** Last complete day of the window, YYYY-MM-DD. */
  asOf: string;
  accountsReached: number | null;
  followers: number | null;
  nonFollowers: number | null;
}

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * One channel's unique reach for one window, one row per recorded day. Days
 * never recorded are absent, not zero: a gap is a gap.
 */
export async function queryChannelReach(input: {
  connectionId: string;
  platform: ReachPlatform;
  windowDays: 7 | 30;
  from: string;
  to: string;
}): Promise<ChannelReachDay[]> {
  if (!isClickHouseEnabled()) return [];

  const result = await getClickHouseClient().query({
    query: `
      SELECT
        toString(as_of) AS day,
        accounts_reached,
        accounts_reached_followers,
        accounts_reached_non_followers
      FROM channel_windows FINAL
      WHERE connection_id = {connectionId: UUID}
        AND platform = {platform: String}
        AND window_days = {windowDays: UInt16}
        AND as_of BETWEEN {from: Date} AND {to: Date}
      ORDER BY as_of
    `,
    query_params: input,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    day: string;
    accounts_reached: string | number | null;
    accounts_reached_followers: string | number | null;
    accounts_reached_non_followers: string | number | null;
  }>();

  return rows.map((row) => ({
    asOf: row.day,
    accountsReached: nullableNumber(row.accounts_reached),
    followers: nullableNumber(row.accounts_reached_followers),
    nonFollowers: nullableNumber(row.accounts_reached_non_followers),
  }));
}

export interface ChannelNewAccountsDay {
  asOf: string;
  /** Seen in the last 7 days and not in the 23 before; null if unknown. */
  newAccounts: number | null;
}

/**
 * "New in the last 7 days (not seen in the 23 before)", Instagram only:
 * 30-day reach minus the reach of the 23 days ending 7 days earlier, both
 * recorded for the same `as_of`. Null when either is missing. A negative
 * difference can only come from Meta's estimates and is shown as 0.
 */
export async function queryChannelNewAccounts(input: {
  connectionId: string;
  from: string;
  to: string;
}): Promise<ChannelNewAccountsDay[]> {
  if (!isClickHouseEnabled()) return [];

  const result = await getClickHouseClient().query({
    query: `
      SELECT
        toString(as_of) AS day,
        anyIf(accounts_reached, window_days = 30) AS reach_30,
        anyIf(accounts_reached, window_days = 23) AS reach_23
      FROM channel_windows FINAL
      WHERE connection_id = {connectionId: UUID}
        AND platform = 'instagram'
        AND window_days IN (23, 30)
        AND as_of BETWEEN {from: Date} AND {to: Date}
      GROUP BY as_of
      ORDER BY as_of
    `,
    query_params: input,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    day: string;
    reach_30: string | number | null;
    reach_23: string | number | null;
  }>();

  return rows.map((row) => {
    const all = nullableNumber(row.reach_30);
    const before = nullableNumber(row.reach_23);

    return {
      asOf: row.day,
      newAccounts:
        all === null || before === null ? null : Math.max(0, all - before),
    };
  });
}

export interface PostAccountsReached {
  /** First-time viewers per day; a day not measured is null. */
  days: Array<{ date: string; accountsReached: number | null }>;
  /** Meta's own lifetime figure from the latest snapshot; null if none. */
  lifetime: number | null;
  /**
   * First-time viewers in the range: the sum of this one post's days, null
   * when any day in range is unmeasured (a partial sum would read as a
   * figure).
   */
  inRange: number | null;
}

/**
 * One post's accounts reached. The days sum within this post only; the
 * lifetime figure is read, never rebuilt from the days (a clamped downward
 * restatement makes the days overshoot).
 */
export async function queryPostAccountsReached(input: {
  projectId: string;
  videoId: string;
  from: string;
  to: string;
}): Promise<PostAccountsReached> {
  if (!isClickHouseEnabled())
    return { days: [], lifetime: null, inRange: null };

  const client = getClickHouseClient();

  const [daysResult, lifetimeResult] = await Promise.all([
    client.query({
      query: `
        SELECT toString(metric_date) AS date, accounts_reached
        FROM video_metrics FINAL
        WHERE project_id = {projectId: UUID}
          AND video_id = {videoId: String}
          AND metric_date BETWEEN {from: Date} AND {to: Date}
        ORDER BY metric_date
      `,
      query_params: input,
      format: 'JSONEachRow',
    }),
    client.query({
      query: `
        SELECT argMax(tuple(accounts_reached), fetched_at).1 AS lifetime
        FROM video_snapshots
        WHERE project_id = {projectId: UUID}
          AND video_id = {videoId: String}
      `,
      query_params: input,
      format: 'JSONEachRow',
    }),
  ]);

  const days = (
    await daysResult.json<{
      date: string;
      accounts_reached: string | number | null;
    }>()
  ).map((row) => ({
    date: row.date,
    accountsReached: nullableNumber(row.accounts_reached),
  }));

  const [lifetimeRow] = await lifetimeResult.json<{
    lifetime: string | number | null;
  }>();

  const measured = days.every((day) => day.accountsReached !== null);

  return {
    days,
    lifetime: nullableNumber(lifetimeRow?.lifetime),
    inRange:
      days.length > 0 && measured
        ? days.reduce((sum, day) => sum + (day.accountsReached ?? 0), 0)
        : null,
  };
}

export interface PostReachSummary {
  /** First-time viewers in the range; null when any day in it is unmeasured. */
  inRange: number | null;
  /** Meta's own lifetime figure from the latest snapshot; null if none. */
  lifetime: number | null;
}

/**
 * `queryPostAccountsReached`'s two figures for many posts in one read, for
 * a table. Grouped by post: each figure is still one post's, and nothing is
 * added across posts. A post with no rows is absent from the map.
 */
export async function queryPostsAccountsReached(input: {
  projectIds: string[];
  videoIds: string[];
  from: string;
  to: string;
}): Promise<Map<string, PostReachSummary>> {
  const summaries = new Map<string, PostReachSummary>();

  if (!isClickHouseEnabled() || input.videoIds.length === 0) return summaries;

  const client = getClickHouseClient();

  const [daysResult, lifetimeResult] = await Promise.all([
    client.query({
      query: `
        SELECT
          video_id,
          sum(accounts_reached) AS in_range,
          countIf(accounts_reached IS NULL) AS unmeasured
        FROM video_metrics FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND metric_date BETWEEN {from: Date} AND {to: Date}
        GROUP BY video_id
      `,
      query_params: input,
      format: 'JSONEachRow',
    }),
    client.query({
      query: `
        SELECT
          video_id,
          argMax(tuple(accounts_reached), fetched_at).1 AS lifetime
        FROM video_snapshots
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
        GROUP BY video_id
      `,
      query_params: input,
      format: 'JSONEachRow',
    }),
  ]);

  for (const row of await daysResult.json<{
    video_id: string;
    in_range: string | number | null;
    unmeasured: string | number;
  }>()) {
    summaries.set(row.video_id, {
      inRange: Number(row.unmeasured) > 0 ? null : nullableNumber(row.in_range),
      lifetime: null,
    });
  }

  for (const row of await lifetimeResult.json<{
    video_id: string;
    lifetime: string | number | null;
  }>()) {
    const summary = summaries.get(row.video_id) ?? {
      inRange: null,
      lifetime: null,
    };
    summaries.set(row.video_id, {
      ...summary,
      lifetime: nullableNumber(row.lifetime),
    });
  }

  return summaries;
}
