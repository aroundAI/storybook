import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { z } from 'zod';

import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { requireRow } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { whyNoRow } from '@kit/shared/rows';
import type { Json } from '@kit/supabase/database';

import { ActionRefusal } from '../lib/action-result';
import { assertCallerToday } from '../lib/caller-date';
import { addRevenue } from '../lib/estimated-revenue';
import {
  assertCanAbandon,
  assertCanConclude,
  assertCanDelete,
  assertCanStart,
  assertEditable,
} from '../lib/experiment-transitions';
import { measuredFigure, sumMeasured } from '../lib/export-coverage';
import {
  type AbandonExperimentSchema,
  type ConcludeExperimentSchema,
  type CreateExperimentSchema,
  type DeleteExperimentSchema,
  type GetExperimentSchema,
  LINKABLE_PAGE_SIZE,
  type ListExperimentsDueSchema,
  type ListExperimentsSchema,
  type ListLinkablePublishesSchema,
  type StartExperimentSchema,
  type UpdateExperimentSchema,
} from '../lib/schemas/experiment.schema';
import { viewsToAdd } from '../lib/views';
import {
  type DateWindow,
  WATCHED_METRICS,
  type WatchedValue,
  baselineWindow,
  daysBetween,
  isWatchedMetricKey,
  resultWindow,
} from '../lib/watched-metrics';
import type { AnalyticsClient } from './analytics-client';
import { resolveWatchedMetric } from './watched-metric-snapshot';

/**
 * The Change Log (FILM-1610) as services over the caller's client
 * (FILM-1906). Access is RLS's throughout: `analytics_experiments` and its
 * link tables are read and written through the client, and a linked video
 * the caller cannot see drops out before ClickHouse is asked about it. A
 * refusal is thrown as an `ActionRefusal`; `experiment-actions.ts` wraps
 * each service in `withRefusals` so the page gets it as a value.
 */

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** Metric totals captured for an experiment at a point in time. */
export interface ExperimentSnapshot {
  capturedAt: string;
  publishCount: number;
  totals: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    /** Null where no video measured it: TikTok reports none (KB-162). */
    watchTimeSeconds: number | null;
    /**
     * USD; null where no linked video's earnings were measured (FILM-1726).
     * Snapshots written before it hold 0 there, which measured nothing.
     */
    revenueCents: number | null;
  };
  /**
   * The experiment's own metric, over its window (FILM-1610). Null when no
   * metric was chosen; absent on snapshots written before FILM-1610.
   */
  watched?: WatchedValue | null;
  /** Result snapshots only: the days that actually elapsed, start to end. */
  resultAfterDays?: number;
  /**
   * Result snapshots only (KB-8): the baseline's window measured again at
   * conclusion, when the days that had not arrived at the start have. Kept
   * beside the start's baseline, never in place of it.
   */
  baselineRemeasured?: WatchedValue;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * An optional text field left empty is no value, not an empty string: the
 * detail view shows "Not recorded" for null and a blank box for ''.
 */
const blankToNull = (value?: string | null) => (value?.trim() ? value : null);

/** The experiment fields a snapshot needs, read before it is taken. */
interface SnapshotContext {
  account_id: string;
  status: string;
  started_at: string | null;
  review_window_days: number;
  metric_watched: string | null;
}

async function readSnapshotContext(
  client: Client,
  experimentId: string,
): Promise<SnapshotContext> {
  const data = requireRow(
    await client
      .from('analytics_experiments')
      .select(
        'account_id, status, started_at, review_window_days, metric_watched',
      )
      .eq('id', experimentId)
      .single(),
    'Change not found or access denied',
  );

  return data as SnapshotContext;
}

/**
 * Sums ClickHouse totals for an experiment's linked publishes, so a
 * before/after comparison exists without the user recording numbers by
 * hand, and resolves the experiment's watched metric over `window`.
 *
 * The totals stay lifetime and unchanged — `experiment-snapshot.test.ts`
 * pins them — so snapshots written before and after FILM-1610 compare.
 */
async function captureSnapshot(
  linked: LinkedPublish[],
  watched?: { metric: string | null; accountId: string; window: DateWindow },
): Promise<ExperimentSnapshot> {
  const publishIds = linked.map((publish) => publish.id);

  const totals: ExperimentSnapshot['totals'] = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchTimeSeconds: null,
    revenueCents: null,
  };

  if (publishIds.length > 0) {
    const perVideo = await queryTotalsByVideoIds(publishIds);

    for (const stats of perVideo.values()) {
      totals.views += viewsToAdd(stats.views);
      totals.likes += stats.likes;
      totals.comments += stats.comments;
      totals.shares += stats.shares;
      // Only measured watch time adds; none measured stays null (KB-162).
      totals.watchTimeSeconds = sumMeasured([
        totals.watchTimeSeconds,
        measuredFigure(stats, 'watch_time_seconds'),
      ]).value;
      totals.revenueCents = addRevenue(
        totals.revenueCents,
        stats.revenue_cents,
      );
    }
  }

  const snapshot: ExperimentSnapshot = {
    capturedAt: new Date().toISOString(),
    publishCount: publishIds.length,
    totals,
  };

  if (watched) {
    snapshot.watched = watched.metric
      ? await resolveWatchedMetric({
          metric: watched.metric,
          accountId: watched.accountId,
          publishIds,
          publishedAt: linked.map((publish) => publish.publishedAt),
          window: watched.window,
        })
      : null;
  }

  return snapshot;
}

/**
 * The linked publishes the caller can read.
 *
 * The `publishes!inner` join is the guard, not decoration: ClickHouse sits
 * outside RLS, so every id returned here is read there unfiltered. A link to
 * a publish the caller cannot see — however it got there — drops out here
 * instead of reporting another tenant's figures.
 *
 * Unpaged, and safe only because the schemas cap `publishIds` at 200, well
 * under the 1,000-row PostgREST cap. Raising that cap means paging this.
 */
async function linkedPublishes(
  client: Client,
  experimentId: string,
): Promise<LinkedPublish[]> {
  const { data, error } = await client
    .from('experiment_publishes')
    .select('publish_id, publishes!inner(published_at)')
    .eq('experiment_id', experimentId);

  // A failed read must not become an empty list: that would snapshot zero
  // videos and report "no linked videos", a false statement about the data.
  if (error) {
    throw new Error(`Failed to read linked videos: ${error.message}`);
  }

  // `publishes` is a many-to-one embed, so PostgREST returns one object;
  // the untyped client cannot know that and infers an array.
  return ((data ?? []) as unknown as LinkedPublishRow[]).map((row) => ({
    id: row.publish_id,
    publishedAt: row.publishes?.published_at ?? null,
  }));
}

/** A linked publish, with its publish time for the "published after" rule. */
interface LinkedPublish {
  id: string;
  publishedAt: string | null;
}

interface LinkedPublishRow {
  publish_id: string;
  publishes: { published_at: string | null } | null;
}

/**
 * Refuses a link to a publish outside the experiment's account.
 *
 * `experiment_publishes` checks access to the experiment only, so without
 * this a caller could attach any publish id. Reading through the caller's
 * client means RLS decides visibility; the account filter then rejects a
 * publish the caller can see but that belongs to a different account.
 */
async function assertPublishesInAccount(
  client: Client,
  accountId: string,
  publishIds: string[],
): Promise<void> {
  if (publishIds.length === 0) return;

  const { data, error } = await client
    .from('publishes')
    .select('id, episodes!inner(projects!inner(account_id))')
    .in('id', publishIds)
    .eq('episodes.projects.account_id', accountId);

  if (error) {
    throw new Error(`Failed to check linked videos: ${error.message}`);
  }

  const found = new Set((data ?? []).map((row) => row.id));
  const missing = publishIds.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new ActionRefusal('Some linked videos are not in this account');
  }
}

/**
 * A lifecycle write that applies only if the experiment is still in one of
 * `from` when the row is written.
 *
 * The status is read and checked first for a clear message, but that check
 * alone is a race: two tabs can both read `planned` and both start, the
 * second overwriting the first's baseline. The status condition on the
 * update itself is what makes it atomic; zero rows matched means someone
 * else moved the experiment first.
 *
 * `unchanged` holds columns that must still read what the action read. The
 * start measures a baseline over the metric and window it read; an edit
 * landing between that read and this write would otherwise freeze a metric
 * the baseline never measured (review 4, G5).
 */
async function updateIfStatus(
  client: Client,
  experimentId: string,
  from: string[],
  payload: Record<string, unknown>,
  what: string,
  unchanged: Record<string, string | number | null> = {},
): Promise<void> {
  let query = client
    .from('analytics_experiments')
    .update(payload)
    .eq('id', experimentId);

  query =
    from.length === 1 ? query.eq('status', from[0]!) : query.in('status', from);

  for (const [column, value] of Object.entries(unchanged)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }

  const { data, error } = await query.select('id');

  if (error) {
    throw new Error(`Failed to ${what}: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new ActionRefusal(
      `This change was edited by someone else before it could ${what}. Reload and try again.`,
    );
  }
}

/** PostgREST reports a refused or failed write as a value, not a throw. */
function throwIfFailed(
  result: { error: { message: string } | null },
  what: string,
): void {
  if (result.error) {
    throw new Error(`Failed to ${what}: ${result.error.message}`);
  }
}

/**
 * Replaces an experiment's links, each set in one database call.
 *
 * `replace_experiment_publishes` deletes and inserts inside one function, so
 * one transaction: a refused insert rolls the delete back. Done as two
 * requests, as it was, a refused insert left the experiment with no videos.
 * The function also removes repeated ids, and runs as the caller, so every
 * policy — the same-account link rule, the planned-only rule — still applies.
 * Capped at 200 ids by the schemas.
 */
async function replaceLinks(
  client: Client,
  experimentId: string,
  publishIds?: string[],
  tagIds?: string[],
): Promise<void> {
  if (publishIds) {
    throwIfFailed(
      await client.rpc('replace_experiment_publishes', {
        p_experiment_id: experimentId,
        p_publish_ids: publishIds,
      }),
      'link videos',
    );
  }

  if (tagIds) {
    throwIfFailed(
      await client.rpc('replace_experiment_tags', {
        p_experiment_id: experimentId,
        p_tag_ids: tagIds,
      }),
      'link tags',
    );
  }
}

export type CreateExperimentInput = z.infer<typeof CreateExperimentSchema>;

export async function createExperimentService(
  client: AnalyticsClient,
  data: CreateExperimentInput,
) {
  await assertPublishesInAccount(client, data.accountId, data.publishIds);

  const { data: experiment, error } = await client
    .from('analytics_experiments')
    .insert({
      account_id: data.accountId,
      project_id: data.projectId ?? null,
      title: data.title,
      hypothesis: blankToNull(data.hypothesis),
      change_description: data.changeDescription,
      expected_outcome: blankToNull(data.expectedOutcome),
      category: data.category ?? null,
      metric_watched: data.metricWatched ?? null,
      review_window_days: data.reviewWindowDays,
      notes: blankToNull(data.notes),
      connection_id: data.connectionId ?? null,
      genome_hypothesis: data.genomeHypothesis ?? null,
      // created_by is set by the database (analytics_experiments_set_creator).
    })
    .select('id')
    .single();

  if (error || !experiment) {
    throw new Error(`Failed to create experiment: ${error?.message}`);
  }

  try {
    await replaceLinks(client, experiment.id, data.publishIds, data.tagIds);
  } catch (linkError) {
    // The experiment row and its links are separate requests, so undo the
    // row that landed. Left in place, a retry would log the experiment
    // twice — once with no videos.
    const cleanup = await client
      .from('analytics_experiments')
      .delete()
      .eq('id', experiment.id);

    if (cleanup.error) {
      const reason =
        linkError instanceof Error ? linkError.message : String(linkError);

      // Both failed: say so, rather than let the orphan pass unnoticed.
      const logger = await getLogger();
      logger.error(
        {
          experimentId: experiment.id,
          reason,
          cleanup: cleanup.error.message,
        },
        'Experiment left without its links',
      );

      throw new ActionRefusal(
        'The videos could not be linked, and the change saved without them could not be removed. It is in the list without its videos.',
      );
    }

    throw linkError;
  }

  return { id: experiment.id };
}

export type UpdateExperimentInput = z.infer<typeof UpdateExperimentSchema>;

export async function updateExperimentService(
  client: AnalyticsClient,
  { experimentId, publishIds, tagIds, ...fields }: UpdateExperimentInput,
) {
  const updates: Record<string, unknown> = {};
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.hypothesis !== undefined)
    updates.hypothesis = blankToNull(fields.hypothesis);
  if (fields.changeDescription !== undefined)
    updates.change_description = fields.changeDescription;
  if (fields.expectedOutcome !== undefined)
    updates.expected_outcome = blankToNull(fields.expectedOutcome);
  if (fields.category !== undefined) updates.category = fields.category;
  if (fields.metricWatched !== undefined)
    updates.metric_watched = fields.metricWatched;
  if (fields.reviewWindowDays !== undefined)
    updates.review_window_days = fields.reviewWindowDays;
  if (fields.notes !== undefined) updates.notes = blankToNull(fields.notes);
  if (fields.connectionId !== undefined)
    updates.connection_id = fields.connectionId;

  const edited = Object.entries({ ...fields, publishIds })
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);

  if (edited.length > 0) {
    const context = await readSnapshotContext(client, experimentId);

    assertEditable(context.status, edited);

    if (publishIds) {
      await assertPublishesInAccount(client, context.account_id, publishIds);
    }
  }

  if (Object.keys(updates).length > 0) {
    // RLS refusing an update matches no row and reports no error, so
    // the rows written are what says it happened.
    const { data: updated, error } = await client
      .from('analytics_experiments')
      .update(updates)
      .eq('id', experimentId)
      .select('id');

    if (error) {
      throw new Error(`Failed to update experiment: ${error.message}`);
    }

    if (!updated || updated.length === 0) {
      throw new ActionRefusal(
        'This change was not saved: it was not found, or you cannot edit it.',
      );
    }
  }

  await replaceLinks(client, experimentId, publishIds, tagIds);

  return { success: true };
}

export type StartExperimentInput = z.infer<typeof StartExperimentSchema>;

/**
 * Marks an experiment running and snapshots the linked content's metrics
 * as the baseline to compare against later.
 */
export async function startExperimentService(
  client: AnalyticsClient,
  { experimentId, startedAt }: StartExperimentInput,
) {
  if (startedAt) assertCallerToday(startedAt);
  const started = startedAt ?? today();

  const context = await readSnapshotContext(client, experimentId);
  assertCanStart(context.status);

  const linked = await linkedPublishes(client, experimentId);
  const baseline = await captureSnapshot(linked, {
    metric: context.metric_watched,
    accountId: context.account_id,
    window: baselineWindow(started, context.review_window_days),
  });

  await updateIfStatus(
    client,
    experimentId,
    ['planned'],
    {
      status: 'running',
      started_at: started,
      baseline_metrics: baseline as unknown as Json,
    },
    'start',
    {
      metric_watched: context.metric_watched,
      review_window_days: context.review_window_days,
    },
  );

  return { success: true, baseline };
}

export type ConcludeExperimentInput = z.infer<typeof ConcludeExperimentSchema>;

/**
 * Concludes an experiment, snapshotting results. The actual outcome is
 * required — an experiment without a recorded result teaches nothing.
 */
export async function concludeExperimentService(
  client: AnalyticsClient,
  {
    experimentId,
    actualOutcome,
    outcomeStatus,
    endedAt,
  }: ConcludeExperimentInput,
) {
  if (endedAt) assertCallerToday(endedAt);
  const ended = endedAt ?? today();

  const context = await readSnapshotContext(client, experimentId);
  assertCanConclude(context.status, context.started_at, ended);

  // assertCanConclude has established this; the type cannot see it.
  const startedAt = context.started_at!;

  const linked = await linkedPublishes(client, experimentId);
  const result = await captureSnapshot(linked, {
    metric: context.metric_watched,
    accountId: context.account_id,
    window: resultWindow(startedAt, ended),
  });

  // What elapsed, not what was planned: a review on day 74 of a 60-day
  // experiment is labelled 74.
  result.resultAfterDays = daysBetween(startedAt, ended);

  // KB-8. Platform data arrives days late, so the start's baseline
  // usually lacks its last days. Measured again now, over the same
  // window, it has them. Stored with the result — written once, by this
  // step — so the start's baseline is never rewritten. The owner decided
  // (2026-09-24) that the page shows both and compares against neither.
  const metric = context.metric_watched;
  if (
    metric &&
    isWatchedMetricKey(metric) &&
    WATCHED_METRICS[metric].windowed
  ) {
    result.baselineRemeasured = await resolveWatchedMetric({
      metric,
      accountId: context.account_id,
      publishIds: linked.map((publish) => publish.id),
      publishedAt: linked.map((publish) => publish.publishedAt),
      window: baselineWindow(startedAt, context.review_window_days),
    });
  }

  await updateIfStatus(
    client,
    experimentId,
    ['running'],
    {
      status: 'concluded',
      ended_at: ended,
      actual_outcome: actualOutcome,
      outcome_status: outcomeStatus,
      result_metrics: result as unknown as Json,
    },
    'conclude',
  );

  return { success: true, result };
}

export type AbandonExperimentInput = z.infer<typeof AbandonExperimentSchema>;

export async function abandonExperimentService(
  client: AnalyticsClient,
  { experimentId, reason, endedAt }: AbandonExperimentInput,
) {
  const context = await readSnapshotContext(client, experimentId);
  assertCanAbandon(context.status);

  // A calendar date, like the start. The server's UTC date can be the day
  // before a start the user made just after their local midnight, and an
  // end before its start is not a date anyone chose. Dates are
  // YYYY-MM-DD, so string order is date order.
  if (endedAt) assertCallerToday(endedAt);
  const requested = endedAt ?? today();
  const ended =
    context.started_at && requested < context.started_at
      ? context.started_at
      : requested;

  await updateIfStatus(
    client,
    experimentId,
    ['planned', 'running'],
    {
      status: 'abandoned',
      ended_at: ended,
      actual_outcome: reason ?? null,
      outcome_status: 'inconclusive',
    },
    'abandon',
  );

  return { success: true };
}

export type ListExperimentsDueInput = z.infer<typeof ListExperimentsDueSchema>;

/**
 * Running experiments whose review date has arrived, soonest first.
 *
 * Paged although the list is normally short: it is the one read in this
 * file that grows with how long an account has used the log.
 */
export async function listExperimentsDueForReviewService(
  client: AnalyticsClient,
  { accountId, asOf }: ListExperimentsDueInput,
) {
  // Both dates are nullable in the table; the filter guarantees them here,
  // but the row type says what the column can hold.
  return fetchAllRows<{
    id: string;
    title: string;
    started_at: string | null;
    review_due_at: string | null;
    metric_watched: string | null;
  }>(
    (from, to) =>
      client
        .from('analytics_experiments')
        .select('id, title, started_at, review_due_at, metric_watched')
        .eq('account_id', accountId)
        .eq('status', 'running')
        .lte('review_due_at', asOf ?? today())
        .order('review_due_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'experiments due for review',
  );
}

/** `%` and `_` are ilike wildcards; a search for "50%" means those characters. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export type ListLinkablePublishesInput = z.infer<
  typeof ListLinkablePublishesSchema
>;

/**
 * The account's published videos matching a title search, newest first, at
 * most LINKABLE_PAGE_SIZE of them.
 *
 * Searched on the server rather than loaded whole: loading every published
 * video on each visit, and rendering each as a picker row, grows without
 * bound with the account. One extra row is asked for so `hasMore` can say
 * "refine the search" without a count.
 */
export async function listLinkablePublishesService(
  client: AnalyticsClient,
  { accountId, search }: ListLinkablePublishesInput,
) {
  let query = client
    .from('publishes')
    .select(
      'id, title, platform, published_at, episodes!inner(projects!inner(account_id))',
    )
    .eq('episodes.projects.account_id', accountId)
    .eq('status', 'published');

  const term = search?.trim();
  if (term) {
    query = query.ilike('title', `%${escapeLike(term)}%`);
  }

  const { data, error } = await query
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(LINKABLE_PAGE_SIZE + 1);

  if (error) {
    throw new Error(`Failed to list videos: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    title: string | null;
    platform: string;
    published_at: string | null;
  }>;

  return {
    videos: rows.slice(0, LINKABLE_PAGE_SIZE).map((row) => ({
      id: row.id,
      title: row.title,
      platform: row.platform,
      publishedAt: row.published_at,
    })),
    hasMore: rows.length > LINKABLE_PAGE_SIZE,
  };
}

export type ListExperimentsInput = z.infer<typeof ListExperimentsSchema>;

/**
 * The account's experiments, newest first.
 *
 * Paged: PostgREST caps a read at 1,000 rows and reports nothing when it
 * does, so an unpaged list would look complete and silently not be. Ordered
 * by `created_at` then `id`, so paging cannot skip or repeat a row that
 * shares a timestamp.
 */
export async function listExperimentsService(
  client: AnalyticsClient,
  { accountId, projectId, status }: ListExperimentsInput,
) {
  return fetchAllRows<{
    id: string;
    title: string;
    hypothesis: string | null;
    status: string;
    outcome_status: string;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    project_id: string | null;
  }>((from, to) => {
    let query = client
      .from('analytics_experiments')
      .select(
        'id, title, hypothesis, status, outcome_status, started_at, ended_at, created_at, project_id',
      )
      .eq('account_id', accountId);

    if (projectId) query = query.eq('project_id', projectId);
    if (status) query = query.eq('status', status);

    return query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
  }, 'experiments');
}

export type GetExperimentInput = z.infer<typeof GetExperimentSchema>;

export async function getExperimentService(
  client: AnalyticsClient,
  { experimentId }: GetExperimentInput,
) {
  const { data: experiment, error } = await client
    .from('analytics_experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (error || !experiment) {
    throw new Error(whyNoRow(error, 'Change not found or access denied'));
  }

  const [publishesResult, tagsResult] = await Promise.all([
    client
      .from('experiment_publishes')
      .select('publish_id, publishes!inner(title, platform, published_at)')
      .eq('experiment_id', experimentId),
    client
      .from('experiment_tags')
      .select('tag_id, content_tags!inner(dimension, slug, label)')
      .eq('experiment_id', experimentId),
  ]);

  // A failed read would otherwise render as an experiment with no videos.
  throwIfFailed(publishesResult, 'read linked videos');
  throwIfFailed(tagsResult, 'read linked tags');

  const publishes = publishesResult.data;
  const tags = tagsResult.data;

  return {
    ...experiment,
    publishes: publishes ?? [],
    tags: tags ?? [],
  };
}

export type DeleteExperimentInput = z.infer<typeof DeleteExperimentSchema>;

export async function deleteExperimentService(
  client: AnalyticsClient,
  { experimentId }: DeleteExperimentInput,
) {
  const context = await readSnapshotContext(client, experimentId);
  assertCanDelete(context.status);

  // The status condition is on the delete itself, as for the lifecycle
  // writes: a change started in another tab since the read is not
  // deleted. The table's policy refuses it too.
  const { data: deleted, error } = await client
    .from('analytics_experiments')
    .delete()
    .eq('id', experimentId)
    .in('status', ['planned', 'abandoned'])
    .select('id');

  if (error) {
    throw new Error(`Failed to delete experiment: ${error.message}`);
  }

  // As with an update: a refused delete removes nothing and says nothing.
  if (!deleted || deleted.length === 0) {
    throw new ActionRefusal(
      'Nothing was deleted: the change was not found, was started since you opened it, or you cannot delete it. Reload and try again.',
    );
  }

  return { success: true };
}
