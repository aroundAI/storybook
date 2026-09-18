'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import type { AggregatedTotals } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AbandonExperimentSchema,
  ConcludeExperimentSchema,
  CreateExperimentSchema,
  DeleteExperimentSchema,
  GetExperimentSchema,
  ListExperimentsDueSchema,
  ListExperimentsSchema,
  ListLinkablePublishesSchema,
  StartExperimentSchema,
  UpdateExperimentSchema,
} from '../lib/schemas/experiment.schema';
import {
  type DateWindow,
  type WatchedValue,
  baselineWindow,
  daysBetween,
  resultWindow,
} from '../lib/watched-metrics';
import { resolveWatchedMetric } from './watched-metric-snapshot';

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
    watchTimeSeconds: number;
    revenueCents: number;
  };
  /**
   * The experiment's own metric, over its window (FILM-1610). Null when no
   * metric was chosen; absent on snapshots written before FILM-1610.
   */
  watched?: WatchedValue | null;
  /** Result snapshots only: the days that actually elapsed, start to end. */
  resultAfterDays?: number;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * An optional text field left empty is no value, not an empty string: the
 * detail view shows "Not recorded" for null and a blank box for ''.
 */
const blankToNull = (value?: string) => (value?.trim() ? value : null);

/** The experiment fields a snapshot needs, read before it is taken. */
interface SnapshotContext {
  account_id: string;
  started_at: string | null;
  review_window_days: number;
  metric_watched: string | null;
}

async function readSnapshotContext(
  client: Client,
  experimentId: string,
): Promise<SnapshotContext> {
  const { data, error } = await client
    .from('analytics_experiments')
    .select('account_id, started_at, review_window_days, metric_watched')
    .eq('id', experimentId)
    .single();

  if (error || !data) {
    throw new Error('Experiment not found or access denied');
  }

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
  publishIds: string[],
  watched?: { metric: string | null; accountId: string; window: DateWindow },
): Promise<ExperimentSnapshot> {
  const totals = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchTimeSeconds: 0,
    revenueCents: 0,
  };

  if (publishIds.length > 0) {
    const perVideo = await queryTotalsByVideoIds(publishIds);

    for (const stats of perVideo.values() as Iterable<AggregatedTotals>) {
      totals.views += stats.views;
      totals.likes += stats.likes;
      totals.comments += stats.comments;
      totals.shares += stats.shares;
      totals.watchTimeSeconds += stats.watch_time_seconds;
      totals.revenueCents += stats.revenue_cents;
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
async function linkedPublishIds(
  client: Client,
  experimentId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('experiment_publishes')
    .select('publish_id, publishes!inner(id)')
    .eq('experiment_id', experimentId);

  // A failed read must not become an empty list: that would snapshot zero
  // videos and report "no linked videos", a false statement about the data.
  if (error) {
    throw new Error(`Failed to read linked videos: ${error.message}`);
  }

  return (data ?? []).map((row) => row.publish_id);
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
    throw new Error('Some linked videos are not in this account');
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
 * Unpaged for the same reason as `linkedPublishIds`: capped at 200.
 *
 * Every write is checked. These results used to be discarded, so a refused
 * insert left an experiment with no videos behind a "logged" toast.
 */
async function replaceLinks(
  client: Client,
  experimentId: string,
  publishIds?: string[],
  tagIds?: string[],
): Promise<void> {
  if (publishIds) {
    throwIfFailed(
      await client
        .from('experiment_publishes')
        .delete()
        .eq('experiment_id', experimentId),
      'clear linked videos',
    );

    if (publishIds.length > 0) {
      throwIfFailed(
        await client.from('experiment_publishes').insert(
          publishIds.map((publishId) => ({
            experiment_id: experimentId,
            publish_id: publishId,
          })),
        ),
        'link videos',
      );
    }
  }

  if (tagIds) {
    throwIfFailed(
      await client
        .from('experiment_tags')
        .delete()
        .eq('experiment_id', experimentId),
      'clear linked tags',
    );

    if (tagIds.length > 0) {
      throwIfFailed(
        await client.from('experiment_tags').insert(
          tagIds.map((tagId) => ({
            experiment_id: experimentId,
            tag_id: tagId,
          })),
        ),
        'link tags',
      );
    }
  }
}

export const createExperimentAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

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
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error || !experiment) {
      throw new Error(`Failed to create experiment: ${error?.message}`);
    }

    try {
      await replaceLinks(client, experiment.id, data.publishIds, data.tagIds);
    } catch (linkError) {
      // PostgREST has no transaction across these writes, so undo the one
      // that landed. Left in place, a retry would log the experiment twice —
      // once with no videos.
      await client
        .from('analytics_experiments')
        .delete()
        .eq('id', experiment.id);
      throw linkError;
    }

    return { id: experiment.id };
  },
  { schema: CreateExperimentSchema, auth: true },
);

export const updateExperimentAction = enhanceAction(
  async ({ experimentId, publishIds, tagIds, ...fields }) => {
    const client = getSupabaseServerClient();

    const updates: Record<string, unknown> = {};
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.hypothesis !== undefined) updates.hypothesis = fields.hypothesis;
    if (fields.changeDescription !== undefined)
      updates.change_description = fields.changeDescription;
    if (fields.expectedOutcome !== undefined)
      updates.expected_outcome = fields.expectedOutcome;
    if (fields.category !== undefined) updates.category = fields.category;
    if (fields.metricWatched !== undefined)
      updates.metric_watched = fields.metricWatched;
    if (fields.reviewWindowDays !== undefined)
      updates.review_window_days = fields.reviewWindowDays;
    if (fields.notes !== undefined) updates.notes = fields.notes;
    if (fields.connectionId !== undefined)
      updates.connection_id = fields.connectionId;

    if (publishIds) {
      const { account_id } = await readSnapshotContext(client, experimentId);
      await assertPublishesInAccount(client, account_id, publishIds);
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await client
        .from('analytics_experiments')
        .update(updates)
        .eq('id', experimentId);

      if (error) {
        throw new Error(`Failed to update experiment: ${error.message}`);
      }
    }

    await replaceLinks(client, experimentId, publishIds, tagIds);

    return { success: true };
  },
  { schema: UpdateExperimentSchema, auth: true },
);

/**
 * Marks an experiment running and snapshots the linked content's metrics
 * as the baseline to compare against later.
 */
export const startExperimentAction = enhanceAction(
  async ({ experimentId, startedAt }) => {
    const client = getSupabaseServerClient();
    const started = startedAt ?? today();

    const context = await readSnapshotContext(client, experimentId);
    const publishIds = await linkedPublishIds(client, experimentId);
    const baseline = await captureSnapshot(publishIds, {
      metric: context.metric_watched,
      accountId: context.account_id,
      window: baselineWindow(started, context.review_window_days),
    });

    const { error } = await client
      .from('analytics_experiments')
      .update({
        status: 'running',
        started_at: started,
        baseline_metrics: baseline as unknown as Json,
      })
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to start experiment: ${error.message}`);
    }

    return { success: true, baseline };
  },
  { schema: StartExperimentSchema, auth: true },
);

/**
 * Concludes an experiment, snapshotting results. The actual outcome is
 * required — an experiment without a recorded result teaches nothing.
 */
export const concludeExperimentAction = enhanceAction(
  async ({ experimentId, actualOutcome, outcomeStatus, endedAt }) => {
    const client = getSupabaseServerClient();
    const ended = endedAt ?? today();

    const context = await readSnapshotContext(client, experimentId);

    if (!context.started_at) {
      throw new Error('An experiment must be started before it is concluded');
    }

    const publishIds = await linkedPublishIds(client, experimentId);
    const result = await captureSnapshot(publishIds, {
      metric: context.metric_watched,
      accountId: context.account_id,
      window: resultWindow(context.started_at, ended),
    });

    // What elapsed, not what was planned: a review on day 74 of a 60-day
    // experiment is labelled 74.
    result.resultAfterDays = daysBetween(context.started_at, ended);

    const { error } = await client
      .from('analytics_experiments')
      .update({
        status: 'concluded',
        ended_at: ended,
        actual_outcome: actualOutcome,
        outcome_status: outcomeStatus,
        result_metrics: result as unknown as Json,
      })
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to conclude experiment: ${error.message}`);
    }

    return { success: true, result };
  },
  { schema: ConcludeExperimentSchema, auth: true },
);

export const abandonExperimentAction = enhanceAction(
  async ({ experimentId, reason }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('analytics_experiments')
      .update({
        status: 'abandoned',
        ended_at: today(),
        actual_outcome: reason ?? null,
        outcome_status: 'inconclusive',
      })
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to abandon experiment: ${error.message}`);
    }

    return { success: true };
  },
  { schema: AbandonExperimentSchema, auth: true },
);

/**
 * Running experiments whose review date has arrived, soonest first.
 *
 * Paged although the list is normally short: it is the one read in this
 * file that grows with how long an account has used the log.
 */
export const listExperimentsDueForReviewAction = enhanceAction(
  async ({ accountId }) => {
    const client = getSupabaseServerClient();

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
          .lte('review_due_at', today())
          .order('review_due_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      'experiments due for review',
    );
  },
  { schema: ListExperimentsDueSchema, auth: true },
);

/**
 * The account's published videos, for linking to an experiment.
 *
 * Paged: an account can publish far more than 1,000 videos, and a picker
 * silently missing the oldest ones would look complete.
 */
export const listLinkablePublishesAction = enhanceAction(
  async ({ accountId }) => {
    const client = getSupabaseServerClient();

    const rows = await fetchAllRows<{
      id: string;
      title: string | null;
      platform: string;
      published_at: string | null;
    }>(
      (from, to) =>
        client
          .from('publishes')
          .select(
            'id, title, platform, published_at, episodes!inner(projects!inner(account_id))',
          )
          .eq('episodes.projects.account_id', accountId)
          .eq('status', 'published')
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to),
      'linkable publishes',
    );

    return rows.map(({ id, title, platform, published_at }) => ({
      id,
      title,
      platform,
      publishedAt: published_at,
    }));
  },
  { schema: ListLinkablePublishesSchema, auth: true },
);

export const listExperimentsAction = enhanceAction(
  async ({ accountId, projectId, status }) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('analytics_experiments')
      .select(
        'id, title, hypothesis, status, outcome_status, started_at, ended_at, created_at, project_id',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list experiments: ${error.message}`);
    }

    return data ?? [];
  },
  { schema: ListExperimentsSchema, auth: true },
);

export const getExperimentAction = enhanceAction(
  async ({ experimentId }) => {
    const client = getSupabaseServerClient();

    const { data: experiment, error } = await client
      .from('analytics_experiments')
      .select('*')
      .eq('id', experimentId)
      .single();

    if (error || !experiment) {
      throw new Error('Experiment not found or access denied');
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
  },
  { schema: GetExperimentSchema, auth: true },
);

export const deleteExperimentAction = enhanceAction(
  async ({ experimentId }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('analytics_experiments')
      .delete()
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to delete experiment: ${error.message}`);
    }

    return { success: true };
  },
  { schema: DeleteExperimentSchema, auth: true },
);
